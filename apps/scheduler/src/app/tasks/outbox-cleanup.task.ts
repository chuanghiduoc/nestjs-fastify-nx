import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

// Hard cap so a runaway OUTBOX_RETENTION_DAYS=99999 in env doesn't silently
// disable cleanup. The env schema clamps the same range; this defence is a
// second line for a direct instantiation that bypasses ConfigModule.
const MAX_RETENTION_DAYS = 365;
const MAX_PARKED_AGE_DAYS = 90;

interface ParkedRow {
  id: string;
  eventType: string;
  attempts: number;
  lastError: string | null;
}

@Injectable()
export class OutboxCleanupTask {
  private readonly logger = new Logger(OutboxCleanupTask.name);
  // Read as instance fields, not module-level constants: a module-level positiveIntEnv() runs while
  // the import graph is evaluated, which is BEFORE ConfigModule.forRoot() parses .env into
  // process.env — so every one of these knobs silently fell back to its default.
  private readonly batchSize = positiveIntEnv('OUTBOX_PURGE_BATCH_SIZE', 1_000);
  private readonly maxBatches = positiveIntEnv('OUTBOX_PURGE_MAX_BATCHES', 200);
  private readonly retentionDays = this.resolveRetentionDays();
  private readonly maxAttempts = positiveIntEnv('OUTBOX_MAX_ATTEMPTS', 10);
  private readonly parkedRetentionDays = this.resolveParkedRetentionDays();
  private running = false;
  private parkedRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadership: SchedulerLeaderService,
  ) {}

  // UTC-pinned to guard against host TZ drift; 03:15 runs after weekly VACUUM at 03:00 Sun.
  @Cron('15 3 * * *', { name: 'outbox-purge', timeZone: 'UTC' })
  async purgeOldOutboxEvents(): Promise<void> {
    if (!this.leadership.isLeader() || this.running) return;
    this.running = true;
    const cutoffDays = this.retentionDays;
    this.logger.log(
      `Starting outbox purge: processedAt IS NOT NULL AND createdAt < NOW() - ${cutoffDays} days`,
    );

    let totalPurged = 0;
    try {
      for (let batch = 0; batch < this.maxBatches; batch++) {
        const deleted = await this.prisma.db.$executeRawUnsafe<number>(
          `DELETE FROM "outbox_events"
             WHERE id IN (
               SELECT id FROM "outbox_events"
                WHERE "processedAt" IS NOT NULL
                  AND "createdAt" < NOW() - ($1 || ' days')::interval
                LIMIT $2
             )`,
          String(cutoffDays),
          this.batchSize,
        );
        const n = Number(deleted ?? 0);
        if (n === 0) break;
        totalPurged += n;
      }
      this.logger.log(`Outbox purge complete: ${totalPurged} row(s) deleted`);
    } catch (err) {
      this.logger.error({ err, totalPurged }, 'Outbox purge failed');
    } finally {
      this.running = false;
    }
  }

  @Cron('50 3 * * *', { name: 'outbox-parked-purge', timeZone: 'UTC' })
  async purgeParkedOutboxEvents(): Promise<void> {
    if (!this.leadership.isLeader() || this.parkedRunning) return;
    this.parkedRunning = true;
    const cutoffDays = this.parkedRetentionDays;

    let totalPurged = 0;
    try {
      for (let batch = 0; batch < this.maxBatches; batch++) {
        const purged = await this.prisma.db.$queryRawUnsafe<ParkedRow[]>(
          `DELETE FROM "outbox_events"
             WHERE id IN (
               SELECT id FROM "outbox_events"
                WHERE "processedAt" IS NULL
                  AND attempts >= $1
                  AND "createdAt" < NOW() - ($2 || ' days')::interval
                ORDER BY "createdAt"
                LIMIT $3
             )
           RETURNING id, "eventType", attempts, "lastError"`,
          this.maxAttempts,
          String(cutoffDays),
          this.batchSize,
        );
        if (purged.length === 0) break;

        for (const row of purged) {
          this.logger.warn(
            {
              outboxId: row.id,
              eventType: row.eventType,
              attempts: row.attempts,
              lastError: row.lastError,
            },
            'Dropping permanently-parked outbox row past its retention window',
          );
        }
        totalPurged += purged.length;
      }
      if (totalPurged > 0) {
        this.logger.warn(
          `Parked outbox purge complete: ${totalPurged} undeliverable row(s) dropped after ${cutoffDays} days`,
        );
      }
    } catch (err) {
      this.logger.error({ err, totalPurged }, 'Parked outbox purge failed');
    } finally {
      this.parkedRunning = false;
    }
  }

  private resolveRetentionDays(): number {
    const raw = positiveIntEnv('OUTBOX_RETENTION_DAYS', 7);
    if (raw > MAX_RETENTION_DAYS) {
      this.logger.warn(`OUTBOX_RETENTION_DAYS=${raw} exceeds cap ${MAX_RETENTION_DAYS}; clamping`);
      return MAX_RETENTION_DAYS;
    }
    return raw;
  }

  private resolveParkedRetentionDays(): number {
    const raw = positiveIntEnv('OUTBOX_PARKED_RETENTION_DAYS', 30);
    const clamped = Math.min(Math.max(raw, this.retentionDays), MAX_PARKED_AGE_DAYS);
    if (clamped !== raw) {
      this.logger.warn(
        `OUTBOX_PARKED_RETENTION_DAYS=${raw} outside [${this.retentionDays}, ${MAX_PARKED_AGE_DAYS}]; using ${clamped}`,
      );
    }
    return clamped;
  }
}
