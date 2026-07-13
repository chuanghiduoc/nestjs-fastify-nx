import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { STORAGE_PORT, type StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { positiveIntEnv, STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

interface CleanupCandidate {
  id: string;
  key: string;
  bucket: string;
  status: string;
  updatedAt: Date;
}

@Injectable()
export class StoredFileCleanupTask {
  private readonly logger = new Logger(StoredFileCleanupTask.name);
  private readonly batchSize = positiveIntEnv('STORED_FILE_CLEANUP_BATCH_SIZE', 500);
  private readonly finalizingStaleMinutes = positiveIntEnv(
    'STORED_FILE_FINALIZING_STALE_MINUTES',
    60,
  );
  private readonly verifyingStaleHours = positiveIntEnv('STORED_FILE_VERIFYING_STALE_HOURS', 24);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly leadership: SchedulerLeaderService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
  async cleanup(): Promise<void> {
    if (!this.leadership.isLeader()) return;
    const finalizingCutoff = new Date(Date.now() - this.finalizingStaleMinutes * 60_000);
    const verifyingCutoff = new Date(Date.now() - this.verifyingStaleHours * 3_600_000);

    const candidates = await this.prisma.db.$queryRaw<CleanupCandidate[]>`
      SELECT sf.id, sf.key, sf.bucket, sf.status, sf."updatedAt"
        FROM stored_files sf
        LEFT JOIN users u ON u.id = sf."userId"
       WHERE u.id IS NULL
          OR sf.status = 'REJECTED'
          OR (sf.status = 'FINALIZING' AND sf."updatedAt" < ${finalizingCutoff})
          OR (sf.status = 'VERIFYING' AND sf."updatedAt" < ${verifyingCutoff})
       ORDER BY sf."updatedAt"
       LIMIT ${this.batchSize}`;

    let deleted = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.db.storedFile.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          updatedAt: candidate.updatedAt,
        },
        data: {
          status: STORED_FILE_STATUS.REJECTED,
          failureReason: 'Lifecycle cleanup',
        },
      });
      if (claimed.count === 0) continue;

      try {
        await this.storage.delete(candidate.key, candidate.bucket);
        await this.prisma.db.storedFile.delete({ where: { id: candidate.id } });
        deleted++;
      } catch (err) {
        this.logger.error(
          `Stored-file cleanup failed: id=${candidate.id} key=${candidate.key} error=${String(err)}`,
        );
      }
    }

    if (deleted > 0) this.logger.log(`Deleted ${deleted} orphaned or stale stored file(s)`);
  }
}
