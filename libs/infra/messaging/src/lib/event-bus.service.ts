import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent, EventPublisherPort } from '@nestjs-fastify-nx/core';

/**
 * In-process implementation of `EventPublisherPort`. Backed by EventEmitter2
 * via `emitAsync` so async listener errors propagate and can be observed by
 * the caller. The application layer decides whether to roll back or treat the
 * failure as non-fatal — this adapter does not swallow.
 *
 * For exactly-once / cross-process delivery, inject a different adapter behind
 * the same `EVENT_PUBLISHER_PORT` token (e.g. an outbox-backed publisher).
 */
@Injectable()
export class EventBusService implements EventPublisherPort {
  private readonly logger = new Logger(EventBusService.name);

  constructor(private readonly emitter: EventEmitter2) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.emitter.emitAsync(event.eventType, event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
