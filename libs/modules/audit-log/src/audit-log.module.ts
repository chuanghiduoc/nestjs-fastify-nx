import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { AUDIT_LOG_REPOSITORY_PORT } from './domain/ports/audit-log-repository.port';
import { PrismaAuditLogRepository } from './infrastructure/repositories/prisma-audit-log.repository';
import { AuditLogListener } from './application/listeners/audit-log.listener';
import { RecordAuditLogHandler } from './application/commands/record-audit-log/record-audit-log.handler';
import { ListAuditLogsCursorHandler } from './application/queries/list-audit-logs-cursor/list-audit-logs-cursor.handler';
import { AuditLogsController } from './presentation/controllers/audit-logs.controller';

const providers = [
  { provide: AUDIT_LOG_REPOSITORY_PORT, useClass: PrismaAuditLogRepository },
  AuditLogListener,
  RecordAuditLogHandler,
];

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [AuditLogsController],
  providers: [...providers, ListAuditLogsCursorHandler],
  exports: [AUDIT_LOG_REPOSITORY_PORT],
})
export class AuditLogModule {}

// Listener-only slice for hosts that must not load the HTTP surface (worker, scheduler): the
// outbox relay republishes domain events in those processes, and the subscriber has to exist there
// for the audit entry to be recorded at all.
@Module({
  imports: [DatabaseModule, MessagingModule],
  providers,
  exports: [AUDIT_LOG_REPOSITORY_PORT],
})
export class AuditLogListenersModule {}
