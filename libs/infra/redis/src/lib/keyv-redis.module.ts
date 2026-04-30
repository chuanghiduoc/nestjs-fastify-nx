import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KeyvRedisStore } from './keyv-redis.store';

@Module({
  imports: [ConfigModule],
  providers: [KeyvRedisStore],
  exports: [KeyvRedisStore],
})
export class KeyvRedisModule {}
