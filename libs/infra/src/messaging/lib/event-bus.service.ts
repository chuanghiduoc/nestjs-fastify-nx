import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent, EventPublisherPort } from '@nestjs-fastify-nx/core';

@Injectable()
export class EventBusService implements EventPublisherPort {
  constructor(private readonly emitter: EventEmitter2) {}

  async publish(event: DomainEvent): Promise<void> {
    const results = await this.emitter.emitAsync(event.eventType, event);
    if (results.length === 0) {
      throw new Error(`No listener registered for domain event "${event.eventType}"`);
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
