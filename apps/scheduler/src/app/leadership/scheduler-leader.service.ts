import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_QUEUE_CLIENT } from '@nestjs-fastify-nx/infra-redis';
import type { OutboxRelayLeadership } from '@nestjs-fastify-nx/infra-messaging';
import type { SchedulerEnvConfig } from '../../config/env.validation';

const LEASE_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

@Injectable()
export class SchedulerLeaderService
  implements OnModuleInit, OnModuleDestroy, OutboxRelayLeadership
{
  private readonly logger = new Logger(SchedulerLeaderService.name);
  private readonly key: string;
  private readonly token = randomUUID();
  private timer?: NodeJS.Timeout;
  private leader = false;

  constructor(
    config: ConfigService<SchedulerEnvConfig, true>,
    @Inject(REDIS_QUEUE_CLIENT) private readonly redis: Redis,
  ) {
    this.key = `${config.get('REDIS_QUEUE_PREFIX', { infer: true })}:scheduler:leader`;
  }

  isLeader(): boolean {
    return this.leader;
  }

  async onModuleInit(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), RENEW_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    try {
      if (this.leader) {
        await this.redis.eval(RELEASE_SCRIPT, 1, this.key, this.token);
      }
    } catch (err) {
      this.logger.warn(`scheduler leader release failed: ${String(err)}`);
    } finally {
      this.leader = false;
    }
  }

  private async tick(): Promise<void> {
    try {
      if (this.leader) {
        const renewed = await this.redis.eval(
          RENEW_SCRIPT,
          1,
          this.key,
          this.token,
          String(LEASE_TTL_MS),
        );
        this.leader = renewed === 1;
        if (this.leader) return;
      }

      const acquired = await this.redis.set(this.key, this.token, 'PX', LEASE_TTL_MS, 'NX');
      this.leader = acquired === 'OK';
    } catch (err) {
      this.leader = false;
      this.logger.warn(`scheduler leader election failed: ${String(err)}`);
    }
  }
}
