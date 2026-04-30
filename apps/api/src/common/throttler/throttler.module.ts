import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler';
import type { EnvConfig } from '../../config/env.validation';
import { ThrottlerRedisStorage } from './throttler-redis.storage';

@Module({
  imports: [ConfigModule],
  providers: [ThrottlerRedisStorage],
  exports: [ThrottlerRedisStorage],
})
class ThrottlerStorageModule {}

@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule, ThrottlerStorageModule],
      inject: [ConfigService, ThrottlerRedisStorage],
      useFactory: (config: ConfigService<EnvConfig, true>, redisStorage: ThrottlerRedisStorage) => {
        const ttlMs = config.get('THROTTLER_TTL', { infer: true }) * 1000;
        const limit = config.get('THROTTLER_LIMIT', { infer: true });
        const enabled = config.get('THROTTLER_ENABLED', { infer: true });
        return {
          throttlers: [{ name: 'default', ttl: ttlMs, limit }],
          storage: redisStorage.storage,
          skipIf: () => !enabled,
        };
      },
    }),
  ],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
