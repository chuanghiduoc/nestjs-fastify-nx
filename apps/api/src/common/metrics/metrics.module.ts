import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { HttpMetricsHook } from './http-metrics.hook';
import { BullMqMetricsListener } from './bullmq-metrics.listener';
import { MetricsIpAllowGuard } from './metrics-ip-allow.guard';

@Module({
  imports: [RedisQueueModule, BullModule.registerQueue({ name: 'email-notification' })],
  controllers: [MetricsController],
  providers: [MetricsService, HttpMetricsHook, BullMqMetricsListener, MetricsIpAllowGuard],
  exports: [MetricsService],
})
export class MetricsModule {}
