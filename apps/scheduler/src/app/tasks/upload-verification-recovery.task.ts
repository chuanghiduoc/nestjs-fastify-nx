import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { enqueueUploadVerification } from '@nestjs-fastify-nx/modules-upload';
import { positiveIntEnv, QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

interface RecoveryCandidate {
  id: string;
  key: string;
  bucket: string;
  contentType: string;
  updatedAt: Date;
}

const RECOVERY_BATCH_SIZE = 100;
const RECOVERY_GRACE_MS = 30_000;
const HOUR_MS = 3_600_000;
const INITIAL_CURSOR = { updatedAt: new Date(0), id: '00000000-0000-0000-0000-000000000000' };

@Injectable()
export class UploadVerificationRecoveryTask {
  private readonly logger = new Logger(UploadVerificationRecoveryTask.name);
  private readonly staleHours = positiveIntEnv('STORED_FILE_VERIFYING_STALE_HOURS', 24);
  private cursor = INITIAL_CURSOR;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.UPLOAD_VERIFICATION) private readonly queue: Queue,
    private readonly leadership: SchedulerLeaderService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'UTC' })
  async recover(): Promise<void> {
    if (!this.leadership.isLeader() || this.running) return;
    this.running = true;
    try {
      const candidates = await this.findCandidates();
      for (const candidate of candidates) {
        if (!this.leadership.isLeader()) return;
        await enqueueUploadVerification(this.queue, {
          key: candidate.key,
          bucket: candidate.bucket,
          declaredContentType: candidate.contentType,
        });
        this.cursor = { updatedAt: candidate.updatedAt, id: candidate.id };
      }
      if (candidates.length < RECOVERY_BATCH_SIZE) this.cursor = INITIAL_CURSOR;
    } catch (err) {
      this.logger.error({ err }, 'Upload verification recovery failed; retrying next tick');
    } finally {
      this.running = false;
    }
  }

  private findCandidates(): Promise<RecoveryCandidate[]> {
    const now = Date.now();
    const graceCutoff = new Date(now - RECOVERY_GRACE_MS);
    const staleCutoff = new Date(now - this.staleHours * HOUR_MS);
    return this.prisma.db.$queryRaw<RecoveryCandidate[]>`
      SELECT id, key, bucket, "contentType", "updatedAt"
      FROM stored_files
      WHERE status = 'VERIFYING' AND "deletedAt" IS NULL
        AND "updatedAt" >= ${staleCutoff} AND "updatedAt" < ${graceCutoff}
        AND ("updatedAt", id) > (${this.cursor.updatedAt}, ${this.cursor.id}::uuid)
      ORDER BY "updatedAt", id
      LIMIT ${RECOVERY_BATCH_SIZE}`;
  }
}
