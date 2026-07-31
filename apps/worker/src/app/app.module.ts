import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { LoggerModule } from 'nestjs-pino';
import { DeadLetterModule, RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { buildPinoLoggerConfig } from '@nestjs-fastify-nx/infra-observability';
import { MALWARE_SCANNER_PORT, UploadVerificationModule } from '@nestjs-fastify-nx/modules-upload';
import { EmailNotificationProcessor } from './processors/email-notification.processor';
import { UploadVerificationProcessor } from './processors/upload-verification.processor';
import { WorkerHealthService } from './health/worker-health.service';
import { MailModule } from './mail/mail.module';
import { validateWorkerConfig } from '../config/env.validation';
import { MalwareScannerService } from './security/malware-scanner.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateWorkerConfig }),
    LoggerModule.forRoot(buildPinoLoggerConfig()),
    // Registers VerifyUploadHandler, which the upload processor dispatches to — the api and this
    // worker therefore run the same stored-file state machine instead of two copies.
    CqrsModule.forRoot(),
    DatabaseModule,
    RedisQueueModule,
    StorageModule,
    UploadVerificationModule,
    // Worker is the single owner of the DLQ router for these queues.
    // forFeature() also registers the source queue with BullMQ, so no
    // separate BullModule.registerQueue is needed.
    DeadLetterModule.forFeature(QUEUE_NAMES.EMAIL_NOTIFICATION),
    DeadLetterModule.forFeature(QUEUE_NAMES.UPLOAD_VERIFICATION),
    MailModule,
  ],
  providers: [
    EmailNotificationProcessor,
    UploadVerificationProcessor,
    MalwareScannerService,
    // The scanner is process-specific (it talks to a local clamd), so it enters the shared
    // verification command through a port.
    { provide: MALWARE_SCANNER_PORT, useExisting: MalwareScannerService },
    WorkerHealthService,
  ],
})
export class AppModule {}
