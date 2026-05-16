import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DeadLetterModule, RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { buildPinoLoggerConfig } from '@nestjs-fastify-nx/infra-observability';
import { EmailNotificationProcessor } from './processors/email-notification.processor';
import { UploadVerificationProcessor } from './processors/upload-verification.processor';
import { WorkerHealthService } from './health/worker-health.service';
import { MailModule } from './mail/mail.module';
import { validateWorkerConfig } from '../config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateWorkerConfig }),
    LoggerModule.forRoot(buildPinoLoggerConfig()),
    RedisQueueModule,
    StorageModule,
    // Worker is the single owner of the DLQ router for these queues.
    // forFeature() also registers the source queue with BullMQ, so no
    // separate BullModule.registerQueue is needed.
    DeadLetterModule.forFeature(QUEUE_NAMES.EMAIL_NOTIFICATION),
    DeadLetterModule.forFeature(QUEUE_NAMES.UPLOAD_VERIFICATION),
    MailModule,
  ],
  providers: [EmailNotificationProcessor, UploadVerificationProcessor, WorkerHealthService],
})
export class AppModule {}
