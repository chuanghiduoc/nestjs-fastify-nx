import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

const BATCH_SIZE = positiveIntEnv('OUTBOX_PURGE_BATCH_SIZE', 1000);
const MAX_BATCHES = positiveIntEnv('OUTBOX_PURGE_MAX_BATCHES', 200);
// Hard cap so a runaway OUTBOX_RETENTION_DAYS=99999 in env doesn't silently
// disable cleanup. Worker env schema clamps the same range; this defence is
// here because the scheduler doesn't run that validator.
const MAX_RETENTION_DAYS = 365;

@Injectable()
export class OutboxCleanupTask {
  private readonly logger = new Logger(OutboxCleanupTask.name);
  private readonly retentionDays = (() => {
    const raw = positiveIntEnv('OUTBOX_RETENTION_DAYS', 7);
    if (raw > MAX_RETENTION_DAYS) {
      new Logger(OutboxCleanupTask.name).warn(
        `OUTBOX_RETENTION_DAYS=${raw} exceeds cap ${MAX_RETENTION_DAYS}; clamping`,
      );
      return MAX_RETENTION_DAYS;
    }
    return raw;
  })();
  private running = false;

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
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const deleted = await this.prisma.db.$executeRawUnsafe<number>(
          `DELETE FROM "outbox_events"
             WHERE id IN (
               SELECT id FROM "outbox_events"
                WHERE "processedAt" IS NOT NULL
                  AND "createdAt" < NOW() - ($1 || ' days')::interval
                LIMIT $2
             )`,
          String(cutoffDays),
          BATCH_SIZE,
        );
        const n = Number(deleted ?? 0);
        if (n === 0) break;
        totalPurged += n;
      }
      this.logger.log(`Outbox purge complete: ${totalPurged} row(s) deleted`);
    } catch (err) {
      this.logger.error(`Outbox purge failed after ${totalPurged} deletion(s): ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
