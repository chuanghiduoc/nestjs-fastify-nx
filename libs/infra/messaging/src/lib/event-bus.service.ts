import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent, EventPublisherPort } from '@nestjs-fastify-nx/core';

// In-process adapter backed by EventEmitter2.emitAsync — listener errors propagate to the caller.
// For exactly-once cross-process delivery, swap this behind EVENT_PUBLISHER_PORT with OutboxPublisher.
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
