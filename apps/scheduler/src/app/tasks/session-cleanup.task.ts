import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';
import { BatchedPurgeRunner, type BatchedPurgeConfig } from './batched-purge.runner';

const PURGE_CONFIG: BatchedPurgeConfig = {
  table: 'sessions',
  column: 'expiresAt',
  envPrefix: 'SESSION',
  defaultBatchSize: 1_000,
  defaultMaxBatches: 200,
  label: 'Session purge',
};

@Injectable()
export class SessionCleanupTask {
  private readonly graceDays = positiveIntEnv('SESSION_PURGE_GRACE_DAYS', 1);

  constructor(
    private readonly leadership: SchedulerLeaderService,
    private readonly purgeRunner: BatchedPurgeRunner,
  ) {}

  // UTC-pinned to guard against host TZ drift; 03:30 sits between the outbox purge (03:15) and
  // verification purge (03:45).
  @Cron('30 3 * * *', { name: 'session-purge', timeZone: 'UTC' })
  async purgeExpiredSessions(): Promise<void> {
    await this.purgeRunner.purgeIfLeader(
      'session-purge',
      this.leadership.isLeader(),
      PURGE_CONFIG,
      this.graceDays,
    );
  }
}
