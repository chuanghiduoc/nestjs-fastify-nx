import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import {
  BULL_JOB_NAMES,
  DOMAIN_EVENTS,
  EMAIL_TEMPLATES,
  QUEUE_NAMES,
  RETRIED_JOB_OPTIONS,
  userEventPayloadSchema,
} from '@nestjs-fastify-nx/shared';

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
      throw new Error(
        `${DOMAIN_EVENTS.USERS_REGISTERED} payload is not deliverable (eventId=${event.eventId})`,
      );
    }

    // BullMQ deduplicates on jobId — outbox redelivery never produces a second email.
    // BullMQ rejects ':' in jobIds — use '__' as separator.
    const jobId = `${BULL_JOB_NAMES.WELCOME_EMAIL}__${event.eventId}`;
    await this.emailQueue.add(
      BULL_JOB_NAMES.WELCOME_EMAIL,
      {
        to: parsed.data.email,
        subject: 'Welcome to the platform!',
        body: `Thank you for registering. Your account ID is ${event.aggregateId}.`,
        templateId: EMAIL_TEMPLATES.WELCOME,
        variables: { userId: event.aggregateId, email: parsed.data.email },
      },
      {
        jobId,
        ...RETRIED_JOB_OPTIONS,
      },
    );

    // Structured, no email — pino redaction only covers object keys, not string interpolation.
    this.logger.log({ jobId, userId: event.aggregateId }, 'Enqueued welcome-email');
  }
}
