import { DynamicModule, Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createDeadLetterRouterClass } from './dead-letter-router';

/**
 * Naming convention for the sibling DLQ queue. Centralized so producers
 * (workers, ops tooling) can reconstruct it from the source name.
 */
export function dlqNameFor(sourceQueue: string): string {
  return `${sourceQueue}.dlq`;
}

/**
 * Wires a per-queue Dead-Letter Router. Importing
 * `DeadLetterModule.forFeature('email-notification')` registers the DLQ
 * queue (`email-notification.dlq`) with BullMQ and instantiates a
 * `@QueueEventsListener('email-notification')` provider that copies any
 * terminally-failed job into the DLQ with full diagnostic metadata.
 *
 * The natural host is every worker replica that owns the source queue.
 * The router uses a deterministic DLQ job id, so concurrent QueueEvents
 * listeners cannot create duplicate DLQ entries for the same failed job.
 */
@Module({})
export class DeadLetterModule {
  static forFeature(sourceQueue: string): DynamicModule {
    const RouterClass = createDeadLetterRouterClass(sourceQueue);
    const dlqName = dlqNameFor(sourceQueue);

    return {
      module: DeadLetterModule,
      imports: [BullModule.registerQueue({ name: sourceQueue }, { name: dlqName })],
      providers: [
        {
          provide: RouterClass,
          useFactory: (source: Queue, dlq: Queue) => new RouterClass(source, dlq),
          inject: [getQueueToken(sourceQueue), getQueueToken(dlqName)],
        },
      ],
      exports: [BullModule],
    };
  }
}
