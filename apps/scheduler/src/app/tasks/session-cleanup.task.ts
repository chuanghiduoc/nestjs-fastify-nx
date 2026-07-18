import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

const BATCH_SIZE = positiveIntEnv('SESSION_PURGE_BATCH_SIZE', 1000);
const MAX_BATCHES = positiveIntEnv('SESSION_PURGE_MAX_BATCHES', 200);
// Better Auth never deletes a session row itself, so this table grows unbounded without this
// purge. Grace period past expiry (not at the boundary) is a small safety margin against clock
// skew between the app server and Postgres — unlike verification tokens, an expired session
// fails auth the same way whether the row is still present or already purged.
const GRACE_DAYS = positiveIntEnv('SESSION_PURGE_GRACE_DAYS', 1);

@Injectable()
export class SessionCleanupTask {
  private readonly logger = new Logger(SessionCleanupTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadership: SchedulerLeaderService,
  ) {}

  // UTC-pinned to guard against host TZ drift; 03:30 sits between the outbox purge (03:15) and
  // verification purge (03:45).
  @Cron('30 3 * * *', { name: 'session-purge', timeZone: 'UTC' })
  async purgeExpiredSessions(): Promise<void> {
    if (!this.leadership.isLeader()) return;
    this.logger.log(`Starting session purge: expiresAt < NOW() - ${GRACE_DAYS} days`);

    let totalPurged = 0;
    try {
      // Batched to keep each DELETE's lock footprint small — the same table serves live auth reads.
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const deleted = await this.prisma.db.$executeRawUnsafe<number>(
          `DELETE FROM "sessions"
             WHERE id IN (
               SELECT id FROM "sessions"
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
      this.logger.log(`Session purge complete: ${totalPurged} row(s) deleted`);
    } catch (err) {
      this.logger.error(`Session purge failed after ${totalPurged} deletion(s): ${String(err)}`);
    }
  }
}
