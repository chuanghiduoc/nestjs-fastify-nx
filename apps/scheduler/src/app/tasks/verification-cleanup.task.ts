import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

const BATCH_SIZE = positiveIntEnv('VERIFICATION_PURGE_BATCH_SIZE', 1000);
const MAX_BATCHES = positiveIntEnv('VERIFICATION_PURGE_MAX_BATCHES', 200);
// Better Auth only deletes a verification row when it is successfully consumed, so every abandoned
// password-reset / email-verification link would otherwise live in the table forever.
//
// Rows are kept for a grace window past expiry rather than deleted the moment they expire: Better
// Auth distinguishes "expired token" from "unknown token", and deleting on the expiry boundary
// would downgrade a user who clicks a just-stale link to a generic "invalid token" error.
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
