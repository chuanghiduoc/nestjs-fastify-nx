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

  @OnEvent('users.registered', { async: true })
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
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(`Enqueued welcome-email (jobId=${jobId}) for ${event.payload.email}`);
  }
}
