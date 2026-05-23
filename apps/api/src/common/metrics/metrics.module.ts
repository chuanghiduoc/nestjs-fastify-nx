import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { HttpMetricsHook } from './http-metrics.hook';
import {
  EmailNotificationMetricsListener,
  UploadVerificationMetricsListener,
} from './bullmq-metrics.listener';
import { MetricsIpAllowGuard } from './metrics-ip-allow.guard';
import { QueueDepthCollector } from './queue-depth.collector';
import { OutboxLagCollector } from './outbox-lag.collector';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisQueueModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EMAIL_NOTIFICATION },
      { name: QUEUE_NAMES.UPLOAD_VERIFICATION },
    ),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    HttpMetricsHook,
    EmailNotificationMetricsListener,
    UploadVerificationMetricsListener,
    MetricsIpAllowGuard,
    QueueDepthCollector,
    OutboxLagCollector,
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
