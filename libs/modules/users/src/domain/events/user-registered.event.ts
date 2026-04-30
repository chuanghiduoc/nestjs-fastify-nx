import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';

export interface UserRegisteredPayload extends Record<string, unknown> {
  email: string;
  ip?: string;
  userAgent?: string;
}

export class UserRegistered implements DomainEvent {
  readonly eventId = generateId();
  readonly eventType = 'users.registered';
  readonly occurredAt = new Date();

  constructor(
    readonly aggregateId: string,
    readonly payload: UserRegisteredPayload,
  ) {}
}
