import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  LocalStorageAdapter,
  STORAGE_PORT,
  type StoragePort,
} from '@nestjs-fastify-nx/infra-storage';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';
import type { SchedulerEnvConfig } from '../../config/env.validation';

const STAGING_PREFIX = 'uploads';
const MS_PER_DAY = 86_400_000;

@Injectable()
export class LocalStagingExpiryTask {
  private readonly logger = new Logger(LocalStagingExpiryTask.name);
  private readonly local: LocalStorageAdapter | null;
  private readonly expiryDays: number;
  private running = false;

  constructor(
    @Inject(STORAGE_PORT) storage: StoragePort,
    config: ConfigService<SchedulerEnvConfig, true>,
    private readonly leadership: SchedulerLeaderService,
  ) {
    this.local = storage instanceof LocalStorageAdapter ? storage : null;
    this.expiryDays = config.get('STORAGE_ORPHAN_EXPIRY_DAYS', { infer: true });
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'local-staging-expiry', timeZone: 'UTC' })
  async expire(): Promise<void> {
    if (!this.local || !this.leadership.isLeader() || this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - this.expiryDays * MS_PER_DAY);
      const deleted = await this.local.deleteObjectsOlderThan(STAGING_PREFIX, cutoff);
      if (deleted > 0) this.logger.log(`Expired ${deleted} unconfirmed local staging object(s)`);
    } catch (err) {
      this.logger.error({ err }, 'Local staging expiry failed');
    } finally {
      this.running = false;
    }
  }
}
