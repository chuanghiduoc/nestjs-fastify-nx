export type { DomainEvent } from './lib/domain/domain-event.interface';
export { AggregateRoot } from './lib/domain/aggregate-root';
export { ValueObject } from './lib/domain/value-object';
export type { EventPublisherPort } from './lib/domain/event-publisher.port';
export { EVENT_PUBLISHER_PORT } from './lib/domain/event-publisher.port';
export {
  BusinessRuleException,
  type BusinessRuleViolation,
  type BusinessRuleExceptionOptions,
} from './lib/errors/business-rule.exception';
