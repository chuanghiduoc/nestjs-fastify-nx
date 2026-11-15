import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';
import { BatchedPurgeRunner, type BatchedPurgeConfig } from './batched-purge.runner';

const PURGE_CONFIG: BatchedPurgeConfig = {
  table: 'notifications',
  column: 'createdAt',
  envPrefix: 'NOTIFICATION',
  defaultBatchSize: 1_000,
  defaultMaxBatches: 100,
  label: 'Notification purge',
  extraWhere: '"readAt" IS NOT NULL',
};

@Injectable()
export class NotificationCleanupTask {
  private readonly retentionDays = positiveIntEnv('NOTIFICATION_PURGE_RETENTION_DAYS', 90);

  constructor(
    private readonly leadership: SchedulerLeaderService,
    private readonly purgeRunner: BatchedPurgeRunner,
  ) {}

  @Cron('55 3 * * *', { name: 'notification-purge', timeZone: 'UTC' })
  async purgeReadNotifications(): Promise<void> {
    await this.purgeRunner.purgeIfLeader(
      'notification-purge',
      this.leadership.isLeader(),
      PURGE_CONFIG,
      this.retentionDays,
    );
  }
}
