import type { DomainEvent } from './domain-event.interface';

// Hexagonal port — handlers never import EventEmitter2, BullMQ, or Kafka directly.
export interface EventPublisherPort {
  publish(event: DomainEvent): void | Promise<void>;
  publishAll(events: DomainEvent[]): void | Promise<void>;
}

export const EVENT_PUBLISHER_PORT: unique symbol = Symbol('EventPublisherPort');
