import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent, EventPublisherPort } from '@nestjs-fastify-nx/core';

function isRejected(outcome: PromiseSettledResult<unknown>): outcome is PromiseRejectedResult {
  return outcome.status === 'rejected';
}

@Injectable()
export class EventBusService implements EventPublisherPort {
  constructor(private readonly emitter: EventEmitter2) {}

  async publish(event: DomainEvent): Promise<void> {
    const listeners = this.emitter.listeners(event.eventType);
    if (listeners.length === 0) {
      throw new Error(`No listener registered for domain event "${event.eventType}"`);
    }
    const outcomes = await Promise.allSettled(
      listeners.map((listener) => Promise.resolve().then(() => listener.call(this.emitter, event))),
    );
    const failure = outcomes.find(isRejected);
    if (failure) throw failure.reason;
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
