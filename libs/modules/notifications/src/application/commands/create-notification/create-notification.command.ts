import { Command } from '@nestjs/cqrs';

export interface CreateNotificationInput {
  /** Deterministic id for idempotent writes (e.g. outbox eventId + recipient). */
  readonly id?: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
  readonly occurredAt?: Date;
}

export class CreateNotificationCommand extends Command<void> {
  readonly id?: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
  readonly occurredAt?: Date;

  constructor(input: CreateNotificationInput) {
    super();
    this.id = input.id;
    this.organizationId = input.organizationId;
    this.userId = input.userId;
    this.type = input.type;
    this.title = input.title;
    this.body = input.body;
    this.data = input.data;
    this.occurredAt = input.occurredAt;
  }
}
