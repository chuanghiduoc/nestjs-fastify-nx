import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerStorageRedisService,
  type ThrottlerStorageRedis,
} from '@nest-lab/throttler-storage-redis';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { redisReconnectStrategy } from '@nestjs-fastify-nx/shared';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

// Fail-open: Redis outage issues a permit rather than 500. Auth paths use a separate Fastify limiter (db=4).
// Set THROTTLER_FAIL_OPEN=false where any lapse is unacceptable.
@Injectable()
export class ThrottlerRedisStorage implements OnModuleDestroy {
  private readonly logger = new Logger('ThrottlerRedis');
  private readonly redis: Redis;
  private readonly inner: ThrottlerStorageRedis;
  private readonly failOpen: boolean;
  readonly storage: ThrottlerStorage;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.failOpen = config.get('THROTTLER_FAIL_OPEN', { infer: true });
    this.redis = new Redis({
      host: config.get('REDIS_CACHE_HOST', { infer: true }),
      port: config.get('REDIS_CACHE_PORT', { infer: true }),
      db: 1,
      maxRetriesPerRequest: 1,
      retryStrategy: redisReconnectStrategy,
      enableOfflineQueue: false,
    });
    this.redis.on('error', (err: Error) => {
      this.logger.error(`ioredis error: ${err.message}`);
    });
    this.inner = new ThrottlerStorageRedisService(this.redis);

    this.storage = this.failOpen ? this.wrapFailOpen(this.inner) : this.inner;

    if (this.failOpen) {
      this.logger.log('Throttler storage fail-open enabled');
    }
  }

  private wrapFailOpen(inner: ThrottlerStorageRedis): ThrottlerStorage {
    const logger = this.logger;
    return {
      increment: async (
        key: string,
        ttl: number,
        limit: number,
        blockDuration: number,
        throttlerName: string,
      ) => {
        try {
          return await inner.increment(key, ttl, limit, blockDuration, throttlerName);
        } catch (err) {
          logger.warn(
            `Storage increment failed for "${key}" — failing open (${(err as Error).message})`,
          );
          return {
            totalHits: 0,
            timeToExpire: Math.ceil(ttl / 1000),
            isBlocked: false,
            timeToBlockExpire: 0,
          };
        }
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
