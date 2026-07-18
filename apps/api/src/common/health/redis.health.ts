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
      // Fail the *probe* fast, but keep the client alive: one retry per command, a short connect
      // timeout, and withTimeout() below already bound how long isHealthy() can block.
      maxRetriesPerRequest: 1,
      // Never return a non-number. ioredis reads that as "stop reconnecting for good", so a Redis
      // blip would kill this probe client permanently — the probe then reports down forever, long
      // after Redis is healthy again, and every replica stays NotReady until someone restarts it.
      // That turns a seconds-long blip into an outage that only ends by hand.
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
        return indicator.down({ message: `${key} ping returned ${result}` });
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
