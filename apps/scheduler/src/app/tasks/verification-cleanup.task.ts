import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';
import { BatchedPurgeRunner, type BatchedPurgeConfig } from './batched-purge.runner';

const PURGE_CONFIG: BatchedPurgeConfig = {
  table: 'verifications',
  column: 'expiresAt',
  envPrefix: 'VERIFICATION',
  defaultBatchSize: 1_000,
  defaultMaxBatches: 200,
  label: 'Verification purge',
};

@Injectable()
export class VerificationCleanupTask {
  private readonly graceDays = positiveIntEnv('VERIFICATION_PURGE_GRACE_DAYS', 1);

  constructor(
    private readonly leadership: SchedulerLeaderService,
    private readonly purgeRunner: BatchedPurgeRunner,
  ) {}

  // UTC-pinned to guard against host TZ drift; 03:45 keeps it clear of the other purge windows.
  @Cron('45 3 * * *', { name: 'verification-purge', timeZone: 'UTC' })
  async purgeExpiredVerifications(): Promise<void> {
    await this.purgeRunner.purgeIfLeader(
      'verification-purge',
      this.leadership.isLeader(),
      PURGE_CONFIG,
      this.graceDays,
    );
  }
}
