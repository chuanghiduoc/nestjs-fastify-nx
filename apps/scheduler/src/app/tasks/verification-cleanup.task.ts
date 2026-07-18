import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

const BATCH_SIZE = positiveIntEnv('VERIFICATION_PURGE_BATCH_SIZE', 1000);
const MAX_BATCHES = positiveIntEnv('VERIFICATION_PURGE_MAX_BATCHES', 200);
// Purged past expiry rather than at it: Better Auth distinguishes an expired token from an unknown
// one, so deleting on the boundary would answer a just-stale link with "invalid token" instead.
const GRACE_DAYS = positiveIntEnv('VERIFICATION_PURGE_GRACE_DAYS', 1);

@Injectable()
export class VerificationCleanupTask {
  private readonly logger = new Logger(VerificationCleanupTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadership: SchedulerLeaderService,
  ) {}

  // UTC-pinned to guard against host TZ drift; 03:45 keeps it clear of the other purge windows.
  @Cron('45 3 * * *', { name: 'verification-purge', timeZone: 'UTC' })
  async purgeExpiredVerifications(): Promise<void> {
    if (!this.leadership.isLeader()) return;
    this.logger.log(`Starting verification purge: expiresAt < NOW() - ${GRACE_DAYS} days`);

    let totalPurged = 0;
    try {
      // Batched to keep each DELETE's lock footprint small — the same table serves live auth reads.
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const deleted = await this.prisma.db.$executeRawUnsafe<number>(
          `DELETE FROM "verifications"
             WHERE id IN (
               SELECT id FROM "verifications"
                WHERE "expiresAt" < NOW() - ($1 || ' days')::interval
                LIMIT $2
             )`,
          String(GRACE_DAYS),
          BATCH_SIZE,
        );
        const n = Number(deleted ?? 0);
        if (n === 0) break;
        totalPurged += n;
      }
      this.logger.log(`Verification purge complete: ${totalPurged} row(s) deleted`);
    } catch (err) {
      this.logger.error(
        `Verification purge failed after ${totalPurged} deletion(s): ${String(err)}`,
      );
    }
  }
}
