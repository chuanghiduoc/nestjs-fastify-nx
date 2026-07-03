import { Command } from '@nestjs/cqrs';

// Written by the audit-log listener in response to a domain event. Command<void> —
// the handler persists and returns nothing; idempotency (P2002 no-op) lives in the repo.
export class RecordAuditLogCommand extends Command<void> {
  constructor(
    readonly eventId: string,
    readonly userId: string,
    readonly action: string,
    readonly resource: string,
    readonly metadata: Record<string, unknown>,
    readonly ipAddress: string | null,
    readonly userAgent: string | null,
    readonly occurredAt: Date,
  ) {
    super();
  }
}
