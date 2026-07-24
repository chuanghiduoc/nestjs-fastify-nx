import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Client as PgClient } from 'pg';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { injectDatabasePassword, positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { UserStatus } from '@nestjs-fastify-nx/modules-users';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

// Validated before DROP so a rogue table sharing the audit_logs_* prefix is never dropped accidentally.
const AUDIT_PARTITION_NAME = /^audit_logs_(\d{4})_(\d{2})$/;

@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);
  private readonly auditRetentionMonths = positiveIntEnv('AUDIT_LOG_RETENTION_MONTHS', 12);
  private readonly inactiveUserRetentionDays = positiveIntEnv('INACTIVE_USER_RETENTION_DAYS', 90);
  private readonly userPurgeBatchSize = positiveIntEnv('USER_PURGE_BATCH_SIZE', 500);
  private readonly userPurgeMaxBatches = positiveIntEnv('USER_PURGE_MAX_BATCHES', 200);
  // @nestjs/schedule does not serialize overlapping ticks; one flag per cron method skips a tick whose
  // predecessor is still running without blocking the other (independent) crons on this class.
  private purgeUsersRunning = false;
  private vacuumRunning = false;
  private ensurePartitionsRunning = false;
  private purgePartitionsRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadership: SchedulerLeaderService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { timeZone: 'UTC' })
  async purgeInactiveUsers(): Promise<void> {
    if (!this.leadership.isLeader() || this.purgeUsersRunning) return;
    this.purgeUsersRunning = true;
    this.logger.log(
      `Starting inactive-user purge (>${this.inactiveUserRetentionDays} days INACTIVE)`,
    );

    const cutoff = new Date(Date.now() - this.inactiveUserRetentionDays * 86_400_000);

    let totalPurged = 0;
    try {
      for (let batch = 0; batch < this.userPurgeMaxBatches; batch++) {
        const candidates = await this.prisma.db.user.findMany({
          where: {
            status: UserStatus.INACTIVE,
            updatedAt: { lt: cutoff },
          },
          select: { id: true },
          take: this.userPurgeBatchSize,
        });

        if (candidates.length === 0) break;

        const { count } = await this.prisma.db.user.deleteMany({
          where: {
            id: { in: candidates.map((u) => u.id) },
            status: UserStatus.INACTIVE,
            updatedAt: { lt: cutoff },
          },
        });

        totalPurged += count;

        if (candidates.length < this.userPurgeBatchSize) break;
      }

      this.logger.log(
        `Purged ${totalPurged} inactive user(s) updated before ${cutoff.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Inactive-user purge failed after ${totalPurged} deletion(s): ${String(error)}`,
      );
    } finally {
      this.purgeUsersRunning = false;
    }
  }

  @Cron('0 3 * * 0', { timeZone: 'UTC' }) // Sunday 03:00 UTC
  async vacuumDatabase(): Promise<void> {
    if (!this.leadership.isLeader() || this.vacuumRunning) return;
    this.vacuumRunning = true;
    this.logger.log('Running VACUUM ANALYZE');

    // Dedicated connection: the pooled client carries DATABASE_STATEMENT_TIMEOUT_MS (30s) and can't
    // guarantee `SET statement_timeout` + VACUUM land on the same backend (VACUUM also can't run in
    // a transaction, ruling out SET LOCAL). DATABASE_DIRECT_URL bypasses a pgbouncer transaction-mode
    // pooler that would otherwise split the two statements across backends; it falls back to
    // DATABASE_URL when no pooler is deployed.
    // Construct inside the try so a Client/DSN construction throw still resets `vacuumRunning` in the
    // finally — otherwise a stuck flag would permanently skip every future run.
    let client: PgClient | undefined;
    try {
      client = new PgClient({
        connectionString: injectDatabasePassword(
          process.env['DATABASE_DIRECT_URL'] ?? process.env['DATABASE_URL'],
          process.env['DB_PASSWORD_FILE'],
        ),
      });
      await client.connect();
      await client.query('SET statement_timeout = 0');
      await client.query('VACUUM ANALYZE');
      this.logger.log('VACUUM ANALYZE complete');
    } catch (error) {
      this.logger.error(`VACUUM ANALYZE failed: ${String(error)}`);
    } finally {
      if (client) {
        try {
          await client.end();
        } catch (closeError) {
          this.logger.error(`Failed to close VACUUM connection: ${String(closeError)}`);
        }
      }
      this.vacuumRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: 'UTC' })
  async ensureAuditLogPartitions(): Promise<void> {
    if (!this.leadership.isLeader() || this.ensurePartitionsRunning) return;
    this.ensurePartitionsRunning = true;
    try {
      for (const offset of [0, 1, 2]) {
        await this.prisma.db
          .$queryRaw`SELECT ensure_audit_log_partition(NOW() + (${offset} || ' months')::interval)`;
      }
      this.logger.log('Ensured audit_logs partitions for current + next 2 months');
    } catch (error) {
      this.logger.error(`Audit partition ensure failed: ${String(error)}`);
    } finally {
      this.ensurePartitionsRunning = false;
    }
  }

  @Cron('30 4 1 * *', { timeZone: 'UTC' }) // 1st of month 04:30 UTC — after partition ensure at 04:00; DROP is O(1) vs streaming DELETE
  async purgeAuditLogPartitions(): Promise<void> {
    if (!this.leadership.isLeader() || this.purgePartitionsRunning) return;
    this.purgePartitionsRunning = true;
    const cutoff = new Date();
    cutoff.setUTCDate(1);
    cutoff.setUTCHours(0, 0, 0, 0);
    // Retention includes the active month: 1 keeps only current, 12 keeps current + 11 prior.
    cutoff.setUTCMonth(cutoff.getUTCMonth() - (this.auditRetentionMonths - 1));

    const cutoffYear = cutoff.getUTCFullYear();
    const cutoffMonth = cutoff.getUTCMonth() + 1;

    let dropped = 0;
    try {
      const partitions = await this.prisma.db.$queryRaw<{ table_name: string }[]>`
        SELECT child.relname AS "table_name"
          FROM pg_inherits i
          JOIN pg_class parent ON parent.oid = i.inhparent
          JOIN pg_class child  ON child.oid = i.inhrelid
         WHERE parent.relname = 'audit_logs'`;

      for (const { table_name } of partitions) {
        const match = AUDIT_PARTITION_NAME.exec(table_name);
        if (!match) continue;

        const year = Number(match[1]);
        const month = Number(match[2]);
        if (month < 1 || month > 12) continue;
        const isOlder = year < cutoffYear || (year === cutoffYear && month < cutoffMonth);
        if (!isOlder) continue;

        // Matched strict YYYY_MM regex — safe for identifier interpolation; $executeRawUnsafe doesn't support identifier params.
        await this.prisma.db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table_name}"`);
        dropped++;
      }

      this.logger.log(
        `Purged ${dropped} audit_logs partition(s) older than ${cutoffYear}-${String(cutoffMonth).padStart(2, '0')}`,
      );
    } catch (error) {
      this.logger.error(`Audit partition purge failed after dropping ${dropped}: ${String(error)}`);
    } finally {
      this.purgePartitionsRunning = false;
    }
  }
}
