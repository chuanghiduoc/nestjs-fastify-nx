import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import { CqrsInstrumentationInitializer } from '@nestjs-fastify-nx/core';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { OutboxRelayModule } from '@nestjs-fastify-nx/infra-messaging';
import { buildPinoLoggerConfig } from '@nestjs-fastify-nx/infra-observability';
import { UsersListenersModule } from '@nestjs-fastify-nx/modules-users';
import { AuditLogModule } from '@nestjs-fastify-nx/modules-audit-log';
import { validateSchedulerConfig } from '../config/env.validation';
import { CleanupTask } from './tasks/cleanup.task';
import { DlqMonitorTask } from './tasks/dlq-monitor.task';
import { HeartbeatTask } from './tasks/heartbeat.task';
import { OutboxCleanupTask } from './tasks/outbox-cleanup.task';
import { SchedulerHealthService } from './health/scheduler-health.service';
import { SchedulerLeadershipModule } from './leadership/scheduler-leadership.module';
import { StoredFileCleanupTask } from './tasks/stored-file-cleanup.task';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateSchedulerConfig }),
    LoggerModule.forRoot(buildPinoLoggerConfig()),
    ScheduleModule.forRoot(),
    // Outbox relay republishes domain events → AuditLogListener dispatches RecordAuditLogCommand
    // on this CommandBus. forRoot() registers the command handler across loaded modules.
    CqrsModule.forRoot(),
    DatabaseModule,
    StorageModule,
    SchedulerLeadershipModule,
    OutboxRelayModule,
    // Listener-only slices live here so the outbox relay's republished
    // domain events reach @OnEvent handlers in the scheduler process. We
    // deliberately avoid importing the full feature modules (UsersModule)
    // because they pull in HTTP controllers + Better Auth guards that have
    // no place in this background worker.
    UsersListenersModule,
    AuditLogModule,
  ],
  providers: [
    CleanupTask,
    DlqMonitorTask,
    HeartbeatTask,
    OutboxCleanupTask,
    SchedulerHealthService,
    StoredFileCleanupTask,
    // Tracing only here — the scheduler has no Prometheus registry, so cqrs_* metrics are
    // skipped (CqrsMetricsRecorderHolder stays unset). See CqrsInstrumentationInitializer.
    CqrsInstrumentationInitializer,
  ],
})
export class AppModule {}
