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
  // Grace floor so the orphan scan never claims a row still being written by an in-flight confirm()
  // whose owner was hard-deleted mid-flight — that would delete a row while confirm() finalizes the
  // object, orphaning a committed object and 500-ing the request.
  private readonly orphanGraceMinutes = positiveIntEnv('STORED_FILE_ORPHAN_GRACE_MINUTES', 60);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly leadership: SchedulerLeaderService,
  ) {}

  // Three separate index-friendly scans instead of one query OR-ing all conditions together: a
  // top-level OR defeats the (status, updatedAt) index because Postgres can't range-scan on a
  // condition that spans rows with different statuses in one pass, forcing a sequential scan of
  // the whole table every hour. Each query below is a single equality-then-range lookup that the
  // (status, updatedAt) index serves directly. Each scan is independently guarded so one failing
  // query doesn't skip the others on the same cron tick.
  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
  async cleanup(): Promise<void> {
    if (!this.leadership.isLeader()) return;

    const finalizingCutoff = new Date(Date.now() - this.finalizingStaleMinutes * 60_000);
    const verifyingCutoff = new Date(Date.now() - this.verifyingStaleHours * 3_600_000);

    await this.processCandidates(
      'REJECTED',
      () =>
        this.prisma.db.$queryRaw<CleanupCandidate[]>`
        SELECT id, key, bucket, status, "updatedAt"
          FROM stored_files
         WHERE status = 'REJECTED'
         ORDER BY "updatedAt"
         LIMIT ${this.batchSize}`,
    );

    await this.processCandidates(
      'FINALIZING (stale)',
      () =>
        this.prisma.db.$queryRaw<CleanupCandidate[]>`
        SELECT id, key, bucket, status, "updatedAt"
          FROM stored_files
         WHERE status = 'FINALIZING' AND "updatedAt" < ${finalizingCutoff}
         ORDER BY "updatedAt"
         LIMIT ${this.batchSize}`,
    );

    await this.processCandidates(
      'VERIFYING (stale)',
      () =>
        this.prisma.db.$queryRaw<CleanupCandidate[]>`
        SELECT id, key, bucket, status, "updatedAt"
          FROM stored_files
         WHERE status = 'VERIFYING' AND "updatedAt" < ${verifyingCutoff}
         ORDER BY "updatedAt"
         LIMIT ${this.batchSize}`,
    );
  }

  // `stored_files.userId` intentionally has no FK (see schema comment) so the scheduler can still
  // see and delete S3 objects after the owning user row is hard-deleted. Detecting those orphans
  // requires an anti-join over the whole table, which can't use the (status, updatedAt) index —
  // so unlike `cleanup()` above this runs once daily rather than hourly, trading a longer
  // worst-case window before a dangling S3 object is reclaimed (non-urgent — storage cost only,
  // no correctness impact) for 24x less scan work.
  @Cron('50 3 * * *', { name: 'stored-file-orphan-purge', timeZone: 'UTC' })
  async cleanupOrphaned(): Promise<void> {
    if (!this.leadership.isLeader()) return;

    const orphanCutoff = new Date(Date.now() - this.orphanGraceMinutes * 60_000);
    await this.processCandidates(
      'orphaned (owner deleted)',
      () =>
        this.prisma.db.$queryRaw<CleanupCandidate[]>`
        SELECT sf.id, sf.key, sf.bucket, sf.status, sf."updatedAt"
          FROM stored_files sf
          LEFT JOIN users u ON u.id = sf."userId"
         WHERE u.id IS NULL AND sf."updatedAt" < ${orphanCutoff}
         ORDER BY sf."updatedAt"
         LIMIT ${this.batchSize}`,
    );
  }

  private async processCandidates(
    label: string,
    fetchCandidates: () => Promise<CleanupCandidate[]>,
  ): Promise<void> {
    let candidates: CleanupCandidate[];
    try {
      candidates = await fetchCandidates();
    } catch (err) {
      this.logger.error(`Stored-file cleanup scan failed (${label}): ${String(err)}`);
      return;
    }

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

    if (deleted > 0) this.logger.log(`Deleted ${deleted} ${label} stored file(s)`);
  }
}
