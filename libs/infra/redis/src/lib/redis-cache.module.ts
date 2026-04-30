import { Global, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KeyvRedisModule } from './keyv-redis.module';
import { KeyvRedisStore } from './keyv-redis.store';
import { RedisCacheService } from './redis-cache.service';

@Global()
@Module({
  imports: [
    KeyvRedisModule,
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule, KeyvRedisModule],
      inject: [ConfigService, KeyvRedisStore],
      useFactory: (config: ConfigService, keyvStore: KeyvRedisStore) => {
        const ttl = config.get<number>('REDIS_CACHE_TTL_MS', 5 * 60 * 1000);
        return { stores: [keyvStore.getStore()], ttl };
      },
    }),
  ],
  providers: [RedisCacheService],
  exports: [RedisCacheService],
})
export class RedisCacheModule {}
