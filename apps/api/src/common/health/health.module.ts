import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { RedisCacheHealthIndicator, RedisQueueHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule, ConfigModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisCacheHealthIndicator, RedisQueueHealthIndicator],
})
export class HealthModule {}
