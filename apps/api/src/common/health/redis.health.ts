import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

interface RedisTarget {
  readonly host: string;
  readonly port: number;
}

abstract class BaseRedisHealthIndicator extends HealthIndicator implements OnModuleDestroy {
  protected readonly redis: Redis;

  constructor(target: RedisTarget) {
    super();
    this.redis = new Redis({
      host: target.host,
      port: target.port,
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    this.redis.on('error', () => {
      // swallow connection errors — surfaced via isHealthy()
    });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const result = await this.redis.ping();
      const ok = result === 'PONG';
      const status = this.getStatus(key, ok);
      if (!ok) {
        throw new HealthCheckError(`${key} ping returned ${result}`, status);
      }
      return status;
    } catch (err) {
      if (err instanceof HealthCheckError) throw err;
      throw new HealthCheckError(`${key} check failed`, this.getStatus(key, false));
    }
  }
}

@Injectable()
export class RedisCacheHealthIndicator extends BaseRedisHealthIndicator {
  constructor(config: ConfigService<EnvConfig, true>) {
    super({
      host: config.get('REDIS_CACHE_HOST', { infer: true }),
      port: config.get('REDIS_CACHE_PORT', { infer: true }),
    });
  }
}

@Injectable()
export class RedisQueueHealthIndicator extends BaseRedisHealthIndicator {
  constructor(config: ConfigService<EnvConfig, true>) {
    super({
      host: config.get('REDIS_QUEUE_HOST', { infer: true }),
      port: config.get('REDIS_QUEUE_PORT', { infer: true }),
    });
  }
}
