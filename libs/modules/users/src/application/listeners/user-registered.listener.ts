import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { UserRegistered } from '../../domain/events/user-registered.event';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';

@Injectable()
export class UserRegisteredListener {
  private readonly logger = new Logger(UserRegisteredListener.name);

  constructor(@InjectQueue(QUEUE_NAMES.EMAIL_NOTIFICATION) private readonly emailQueue: Queue) {}

  // The outbox relay must await this deferred listener and receive queue failures. Nest's
  // default `suppressErrors: true` would otherwise log the error and mark the row processed.
  @OnEvent('users.registered', { async: true, promisify: true, suppressErrors: false })
  async handle(event: UserRegistered): Promise<void> {
    // BullMQ deduplicates on jobId — outbox redelivery never produces a second email.
    // BullMQ rejects ':' in jobIds — use '__' as separator.
    const jobId = `welcome-email__${event.eventId}`;
    await this.emailQueue.add(
      'welcome-email',
      {
        to: event.payload.email,
        subject: 'Welcome to the platform!',
        body: `Thank you for registering. Your account ID is ${event.aggregateId}.`,
        templateId: 'welcome',
        variables: { userId: event.aggregateId, email: event.payload.email },
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
