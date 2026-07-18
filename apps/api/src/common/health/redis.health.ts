import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

const PROBE_TIMEOUT_MS = 2_000;
const PROBE_RECONNECT_STEP_MS = 200;
const PROBE_RECONNECT_CAP_MS = 2_000;

interface RedisTarget {
  readonly host: string;
  readonly port: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Always clearTimeout in finally — otherwise the closure blocks clean shutdown.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Health probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

abstract class BaseRedisHealthIndicator implements OnModuleDestroy {
  protected readonly redis: Redis;

  constructor(
    private readonly healthIndicator: HealthIndicatorService,
    target: RedisTarget,
  ) {
    this.redis = new Redis({
      host: target.host,
      port: target.port,
      lazyConnect: true,
      connectTimeout: PROBE_TIMEOUT_MS,
      // Bounds how long a single probe blocks. Killing the client is NOT how to fail fast:
      // ioredis reads a non-number from retryStrategy as "stop reconnecting for good", so one
      // Redis blip would leave this probe reporting down forever and every replica NotReady
      // until a human restarts it.
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) =>
        Math.min(times * PROBE_RECONNECT_STEP_MS, PROBE_RECONNECT_CAP_MS),
    });
    this.redis.on('error', () => {
      // swallow connection errors — surfaced via isHealthy()
    });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicator.check(key);
    try {
      const result = await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS);
      if (result !== 'PONG') {
        return indicator.down({ message: `${key} ping returned ${String(result)}` });
      }
      return indicator.up();
    } catch {
      return indicator.down({ message: `${key} check failed` });
    }
  }
}

@Injectable()
export class RedisCacheHealthIndicator extends BaseRedisHealthIndicator {
  constructor(healthIndicator: HealthIndicatorService, config: ConfigService<EnvConfig, true>) {
    super(healthIndicator, {
      host: config.get('REDIS_CACHE_HOST', { infer: true }),
      port: config.get('REDIS_CACHE_PORT', { infer: true }),
    });
  }
}

@Injectable()
export class RedisQueueHealthIndicator extends BaseRedisHealthIndicator {
  constructor(healthIndicator: HealthIndicatorService, config: ConfigService<EnvConfig, true>) {
    super(healthIndicator, {
      host: config.get('REDIS_QUEUE_HOST', { infer: true }),
      port: config.get('REDIS_QUEUE_PORT', { infer: true }),
    });
  }
}
