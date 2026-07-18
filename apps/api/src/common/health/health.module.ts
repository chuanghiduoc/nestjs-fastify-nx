import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaReplicationLagHealthIndicator } from '@nestjs-fastify-nx/infra-database';
import { MetricsIpAllowGuard } from '../metrics/metrics-ip-allow.guard';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { RedisCacheHealthIndicator, RedisQueueHealthIndicator } from './redis.health';
import { BullMqHealthIndicator } from './bullmq-health.indicator';
import { PgBouncerHealthIndicator } from './pgbouncer-health.indicator';

@Module({
  imports: [TerminusModule, ConfigModule],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    RedisCacheHealthIndicator,
    RedisQueueHealthIndicator,
    BullMqHealthIndicator,
    PgBouncerHealthIndicator,
    PrismaReplicationLagHealthIndicator,
    // Reused (not re-implemented) so /health/dependencies shares the trusted-network allowlist
    // with /metrics rather than growing a second CIDR-parsing implementation.
    MetricsIpAllowGuard,
  ],
})
export class HealthModule {}
