import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import {
  AUDIT_LOG_REPOSITORY_PORT,
  type AuditLogRepositoryPort,
} from '../../domain/ports/audit-log-repository.port';
import { AuditLog } from '../../domain/entities/audit-log.entity';

export interface RecordAuditLogInput {
  readonly eventId: string;
  readonly organizationId: string | null;
  readonly userId: string | null;
  readonly action: string;
  readonly resource: string;
  readonly metadata: Record<string, unknown>;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly occurredAt: Date;
}

export class RecordAuditLogCommand extends Command<void> {
  readonly eventId: string;
  readonly organizationId: string | null;
  readonly userId: string | null;
  readonly action: string;
  readonly resource: string;
  readonly metadata: Record<string, unknown>;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly occurredAt: Date;

  constructor(input: RecordAuditLogInput) {
    super();
    this.eventId = input.eventId;
    this.organizationId = input.organizationId;
    this.userId = input.userId;
    this.action = input.action;
    this.resource = input.resource;
    this.metadata = input.metadata;
    this.ipAddress = input.ipAddress;
    this.userAgent = input.userAgent;
    this.occurredAt = input.occurredAt;
  }
}

@CommandHandler(RecordAuditLogCommand)
export class RecordAuditLogHandler implements ICommandHandler<RecordAuditLogCommand, void> {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY_PORT) private readonly repository: AuditLogRepositoryPort,
  ) {}

  async execute(command: RecordAuditLogCommand): Promise<void> {
    // id derived from eventId so outbox redelivery reproduces the same PK; repo treats P2002 as no-op.
    const entry = AuditLog.create({ id: command.eventId, ...command });

    await this.repository.append(entry);
  }
}
