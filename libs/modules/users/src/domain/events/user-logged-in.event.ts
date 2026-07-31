import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';

export interface UserLoggedInPayload extends Record<string, unknown> {
  sessionId: string;
  ip?: string;
  userAgent?: string;
}

export class UserLoggedIn implements DomainEvent {
  readonly eventId = generateId();
  readonly eventType = DOMAIN_EVENTS.USERS_LOGGED_IN;
  readonly occurredAt = new Date();

  constructor(
    readonly aggregateId: string,
    readonly payload: UserLoggedInPayload,
  ) {}
}
