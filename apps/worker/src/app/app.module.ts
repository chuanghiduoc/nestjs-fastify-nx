import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DeadLetterModule, RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { buildPinoLoggerConfig } from '@nestjs-fastify-nx/infra-observability';
import { EmailNotificationProcessor } from './processors/email-notification.processor';
import { WorkerHealthService } from './health/worker-health.service';
import { MailModule } from './mail/mail.module';
import { validateWorkerConfig } from '../config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateWorkerConfig }),
    LoggerModule.forRoot(buildPinoLoggerConfig()),
    RedisQueueModule,
    // Worker is the single owner of the email-notification DLQ router.
    // forFeature() also registers the source queue with BullMQ, so no separate
    // BullModule.registerQueue is needed.
    DeadLetterModule.forFeature(QUEUE_NAMES.EMAIL_NOTIFICATION),
    MailModule,
  ],
  providers: [EmailNotificationProcessor, WorkerHealthService],
})
export class AppModule {}
