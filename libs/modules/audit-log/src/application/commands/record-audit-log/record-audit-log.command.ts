import { Command } from '@nestjs/cqrs';

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
