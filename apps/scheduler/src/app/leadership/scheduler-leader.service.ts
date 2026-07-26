import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_QUEUE_CLIENT, RedisLeaderLease } from '@nestjs-fastify-nx/infra-redis';
import type { OutboxRelayLeadership } from '@nestjs-fastify-nx/infra-messaging';
import type { SchedulerEnvConfig } from '../../config/env.validation';

// Exactly one scheduler replica runs the crons and drains the outbox. Lease mechanics live in
// RedisLeaderLease (@nestjs-fastify-nx/infra-redis) — shared with the API's metrics collector
// leader rather than duplicated here.
@Injectable()
export class SchedulerLeaderService
  implements OnModuleInit, OnModuleDestroy, OutboxRelayLeadership
{
  private readonly logger = new Logger(SchedulerLeaderService.name);
  private readonly lease: RedisLeaderLease;

  constructor(
    config: ConfigService<SchedulerEnvConfig, true>,
    @Inject(REDIS_QUEUE_CLIENT) redis: Redis,
  ) {
    this.lease = new RedisLeaderLease({
      redis,
      key: `${config.get('REDIS_QUEUE_PREFIX', { infer: true })}:scheduler:leader`,
      onError: (message) => this.logger.warn(`scheduler ${message}`),
    });
  }

  isLeader(): boolean {
    return this.lease.isLeader();
  }

  async onModuleInit(): Promise<void> {
    await this.lease.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.lease.stop();
  }
}
