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
 * Hosting: only one process per cluster should import this for a given
 * queue. The natural home is the worker that owns the source queue.
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
