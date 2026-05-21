import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';

const BATCH_SIZE = positiveIntEnv('OUTBOX_PURGE_BATCH_SIZE', 1000);
const MAX_BATCHES = positiveIntEnv('OUTBOX_PURGE_MAX_BATCHES', 200);

@Injectable()
export class OutboxCleanupTask {
  private readonly logger = new Logger(OutboxCleanupTask.name);
  private readonly retentionDays = positiveIntEnv('OUTBOX_RETENTION_DAYS', 7);

  constructor(private readonly prisma: PrismaService) {}

  // UTC-pinned to guard against host TZ drift; 03:15 runs after weekly VACUUM at 03:00 Sun.
  @Cron('15 3 * * *', { name: 'outbox-purge', timeZone: 'UTC' })
  async purgeOldOutboxEvents(): Promise<void> {
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
    }
  }
}
