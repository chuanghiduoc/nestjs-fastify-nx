import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';

export interface UserLoggedOutPayload extends Record<string, unknown> {
  tokenId: string;
  ip?: string;
  userAgent?: string;
  sessionExpiresAt?: string;
}

export class UserLoggedOut implements DomainEvent {
  readonly eventId = generateId();
  readonly eventType = 'users.logged_out';
  readonly occurredAt = new Date();

  constructor(
    readonly aggregateId: string,
    readonly payload: UserLoggedOutPayload,
  ) {}
}
