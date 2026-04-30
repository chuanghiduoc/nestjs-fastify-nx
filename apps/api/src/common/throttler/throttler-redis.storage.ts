import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

@Injectable()
export class ThrottlerRedisStorage implements OnModuleDestroy {
  private readonly logger = new Logger('ThrottlerRedis');
  private readonly redis: Redis;
  readonly storage: ThrottlerStorageRedisService;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.redis = new Redis({
      host: config.get('REDIS_CACHE_HOST', { infer: true }),
      port: config.get('REDIS_CACHE_PORT', { infer: true }),
      db: 1,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => (times >= 10 ? null : Math.min(times * 200, 3000)),
    });
    this.redis.on('error', (err: Error) => {
      this.logger.error(`ioredis error: ${err.message}`);
    });
    this.storage = new ThrottlerStorageRedisService(this.redis);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
