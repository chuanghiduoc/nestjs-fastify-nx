import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

const PROBE_TIMEOUT_MS = 2_000;

interface RedisTarget {
  readonly host: string;
  readonly port: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Clear the timer whether the probe wins or loses — without this the reject
  // closure keeps a reference alive until the timer fires, blocking clean shutdown.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Health probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

abstract class BaseRedisHealthIndicator extends HealthIndicator implements OnModuleDestroy {
  protected readonly redis: Redis;

  constructor(target: RedisTarget) {
    super();
    this.redis = new Redis({
      host: target.host,
      port: target.port,
      lazyConnect: true,
      connectTimeout: PROBE_TIMEOUT_MS,
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
      const result = await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS);
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
