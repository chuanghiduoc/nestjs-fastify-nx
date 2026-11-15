import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { AUDIT_LOG_REPOSITORY_PORT } from './audit-log-repository.port';
import { PrismaAuditLogRepository } from './prisma-audit-log.repository';
import { AuditLogListener } from './audit-log.listener';
import { RecordAuditLogHandler } from './record-audit-log';

@Module({
  imports: [DatabaseModule, MessagingModule],
  providers: [
    { provide: AUDIT_LOG_REPOSITORY_PORT, useClass: PrismaAuditLogRepository },
    AuditLogListener,
    RecordAuditLogHandler,
  ],
})
export class AuditLogListenersModule {}
