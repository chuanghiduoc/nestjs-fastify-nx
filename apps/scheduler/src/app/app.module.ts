import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { OutboxRelayModule } from '@nestjs-fastify-nx/infra-messaging';
import { SENSITIVE_REDACT_CENSOR, SENSITIVE_REDACT_PATHS } from '@nestjs-fastify-nx/shared';
import { UsersListenersModule } from '@nestjs-fastify-nx/modules-users';
import { AuditLogModule } from '@nestjs-fastify-nx/modules-audit-log';
import { CleanupTask } from './tasks/cleanup.task';
import { HeartbeatTask } from './tasks/heartbeat.task';
import { SchedulerHealthService } from './health/scheduler-health.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
        level: process.env['LOG_LEVEL'] ?? 'info',
        redact: { paths: SENSITIVE_REDACT_PATHS, censor: SENSITIVE_REDACT_CENSOR },
      },
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    OutboxRelayModule,
    // Listener-only slices live here so the outbox relay's republished
    // domain events reach @OnEvent handlers in the scheduler process. We
    // deliberately avoid importing the full feature modules (UsersModule)
    // because they pull in HTTP controllers + Better Auth guards that have
    // no place in this background worker.
    UsersListenersModule,
    AuditLogModule,
  ],
  providers: [CleanupTask, HeartbeatTask, SchedulerHealthService],
})
export class AppModule {}
