import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';
import { BatchedPurgeRunner, type BatchedPurgeConfig } from './batched-purge.runner';

const PURGE_CONFIG: BatchedPurgeConfig = {
  table: 'invitations',
  column: 'expiresAt',
  envPrefix: 'INVITATION',
  defaultBatchSize: 500,
  defaultMaxBatches: 100,
  label: 'Invitation purge',
};

@Injectable()
export class InvitationCleanupTask {
  private readonly retentionDays = positiveIntEnv('INVITATION_PURGE_RETENTION_DAYS', 30);

  constructor(
    private readonly leadership: SchedulerLeaderService,
    private readonly purgeRunner: BatchedPurgeRunner,
  ) {}

  @Cron('10 4 * * *', { name: 'invitation-purge', timeZone: 'UTC' })
  async purgeExpiredInvitations(): Promise<void> {
    await this.purgeRunner.purgeIfLeader(
      'invitation-purge',
      this.leadership.isLeader(),
      PURGE_CONFIG,
      this.retentionDays,
    );
  }
}
