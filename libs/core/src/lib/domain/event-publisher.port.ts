import type { DomainEvent } from './domain-event.interface';

/**
 * Hexagonal port for publishing domain events out of the application layer.
 *
 * The application/handler code depends on this interface only — it never
 * touches `EventEmitter2`, BullMQ, Kafka or the Outbox table directly.
 * Concrete adapters live in `libs/infra/messaging` (in-process emitter) or in
 * a future outbox/transactional-outbox adapter.
 *
 * Implementations may be synchronous or asynchronous. Callers that need
 * exactly-once delivery semantics should publish through the
 * outbox-backed adapter rather than the in-process emitter.
 */
export interface EventPublisherPort {
  publish(event: DomainEvent): void | Promise<void>;
  publishAll(events: DomainEvent[]): void | Promise<void>;
}

/**
 * DI token used to wire concrete adapters into NestJS providers without
 * leaking class identity. Modules use `@Inject(EVENT_PUBLISHER_PORT)`.
 */
export const EVENT_PUBLISHER_PORT: unique symbol = Symbol('EventPublisherPort');
