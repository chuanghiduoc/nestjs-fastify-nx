import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';

export interface UserLoggedInPayload extends Record<string, unknown> {
  ip?: string;
  userAgent?: string;
}

export class UserLoggedIn implements DomainEvent {
  readonly eventId = generateId();
  readonly eventType = 'users.logged_in';
  readonly occurredAt = new Date();

  constructor(
    readonly aggregateId: string,
    readonly payload: UserLoggedInPayload,
  ) {}
}
