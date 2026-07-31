import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENTS, QUEUE_NAMES, userEventPayloadSchema } from '@nestjs-fastify-nx/shared';

@Injectable()
export class UserRegisteredListener {
  private readonly logger = new Logger(UserRegisteredListener.name);

  constructor(@InjectQueue(QUEUE_NAMES.EMAIL_NOTIFICATION) private readonly emailQueue: Queue) {}

  // The outbox relay must await this deferred listener and receive queue failures. Nest's
  // default `suppressErrors: true` would otherwise log the error and mark the row processed.
  // The relay reconstructs a plain DomainEvent from the outbox row — it is NEVER a UserRegistered
  // instance, so the payload is parsed here rather than trusted.
  @OnEvent(DOMAIN_EVENTS.USERS_REGISTERED, { async: true, promisify: true, suppressErrors: false })
  async handle(event: DomainEvent): Promise<void> {
    const parsed = userEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      // Throwing lets the outbox record lastError and retry; swallowing would drop the email
      // silently and mark the row processed.
      throw new Error(`users.registered payload is not deliverable (eventId=${event.eventId})`);
    }

    // BullMQ deduplicates on jobId — outbox redelivery never produces a second email.
    // BullMQ rejects ':' in jobIds — use '__' as separator.
    const jobId = `welcome-email__${event.eventId}`;
    await this.emailQueue.add(
      'welcome-email',
      {
        to: parsed.data.email,
        subject: 'Welcome to the platform!',
        body: `Thank you for registering. Your account ID is ${event.aggregateId}.`,
        templateId: 'welcome',
        variables: { userId: event.aggregateId, email: parsed.data.email },
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 30 * 24 * 60 * 60, count: 10_000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 1_000 },
      },
    );

    // Structured, no email — pino redaction only covers object keys, not string interpolation.
    this.logger.log({ jobId, userId: event.aggregateId }, 'Enqueued welcome-email');
  }
}
