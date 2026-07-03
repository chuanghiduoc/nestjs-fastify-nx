import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RecordAuditLogCommand } from './record-audit-log.command';
import { AUDIT_LOG_REPOSITORY_PORT } from '../../../domain/ports/audit-log-repository.port';
import type { AuditLogRepositoryPort } from '../../../domain/ports/audit-log-repository.port';
import { AuditLog } from '../../../domain/entities/audit-log.entity';

@CommandHandler(RecordAuditLogCommand)
export class RecordAuditLogHandler implements ICommandHandler<RecordAuditLogCommand, void> {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY_PORT) private readonly repository: AuditLogRepositoryPort,
  ) {}

  async execute(command: RecordAuditLogCommand): Promise<void> {
    const entry = AuditLog.create({
      // id derived from eventId so outbox redelivery reproduces the same PK; repo treats P2002 as no-op.
      id: command.eventId,
      userId: command.userId,
      action: command.action,
      resource: command.resource,
      metadata: command.metadata,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      occurredAt: command.occurredAt,
    });

    await this.repository.append(entry);
  }
}
