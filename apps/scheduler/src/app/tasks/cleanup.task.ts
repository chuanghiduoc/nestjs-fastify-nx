import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { UserStatus } from '@nestjs-fastify-nx/modules-users';

const PURGE_BATCH_SIZE = 500;
const PURGE_MAX_BATCHES = 200;

// Validated before DROP so a rogue table sharing the audit_logs_* prefix is never dropped accidentally.
const AUDIT_PARTITION_NAME = /^audit_logs_(\d{4})_(\d{2})$/;

@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);
  private readonly auditRetentionMonths = positiveIntEnv('AUDIT_LOG_RETENTION_MONTHS', 12);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeInactiveUsers(): Promise<void> {
    this.logger.log('Starting inactive-user purge (>90 days INACTIVE)');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    let totalPurged = 0;
    try {
      for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
        const candidates = await this.prisma.db.user.findMany({
          where: {
            status: UserStatus.INACTIVE,
            updatedAt: { lt: cutoff },
          },
          select: { id: true },
          take: PURGE_BATCH_SIZE,
        });

        if (candidates.length === 0) break;

        const { count } = await this.prisma.db.user.deleteMany({
          where: { id: { in: candidates.map((u) => u.id) } },
        });

        totalPurged += count;

        if (candidates.length < PURGE_BATCH_SIZE) break;
      }

      this.logger.log(
        `Purged ${totalPurged} inactive user(s) updated before ${cutoff.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Inactive-user purge failed after ${totalPurged} deletion(s): ${String(error)}`,
      );
    }
  }

  @Cron('0 3 * * 0') // Sunday 03:00 UTC
  async vacuumDatabase(): Promise<void> {
    this.logger.log('Running VACUUM ANALYZE');

    try {
      await this.prisma.db.$executeRaw`VACUUM ANALYZE`;
      this.logger.log('VACUUM ANALYZE complete');
    } catch (error) {
      this.logger.error(`VACUUM ANALYZE failed: ${String(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async ensureAuditLogPartitions(): Promise<void> {
    try {
      for (const offset of [0, 1, 2]) {
        await this.prisma.db
          .$executeRaw`SELECT ensure_audit_log_partition(NOW() + (${offset} || ' months')::interval)`;
      }
      this.logger.log('Ensured audit_logs partitions for current + next 2 months');
    } catch (error) {
      this.logger.error(`Audit partition ensure failed: ${String(error)}`);
    }
  }

  @Cron('30 4 1 * *') // 1st of month 04:30 UTC — after partition ensure at 04:00; DROP is O(1) vs streaming DELETE
  async purgeAuditLogPartitions(): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(1);
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - this.auditRetentionMonths);

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
    }
  }
}
