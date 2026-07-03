import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { AUDIT_LOG_REPOSITORY_PORT } from './domain/ports/audit-log-repository.port';
import { PrismaAuditLogRepository } from './infrastructure/repositories/prisma-audit-log.repository';
import { AuditLogListener } from './application/listeners/audit-log.listener';
import { RecordAuditLogHandler } from './application/commands/record-audit-log/record-audit-log.handler';

@Module({
  imports: [DatabaseModule, MessagingModule],
  providers: [
    { provide: AUDIT_LOG_REPOSITORY_PORT, useClass: PrismaAuditLogRepository },
    AuditLogListener,
    RecordAuditLogHandler,
  ],
  exports: [AUDIT_LOG_REPOSITORY_PORT],
})
export class AuditLogModule {}
