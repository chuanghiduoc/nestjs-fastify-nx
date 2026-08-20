export type { DomainEvent } from './lib/domain/domain-event.interface';
export { ValueObject } from './lib/domain/value-object';
export type { EventPublisherPort } from './lib/domain/event-publisher.port';
export { EVENT_PUBLISHER_PORT } from './lib/domain/event-publisher.port';
export {
  DomainException,
  isDomainException,
  type DomainErrorKind,
  type DomainViolation,
  type DomainExceptionOptions,
} from './lib/errors/domain.exception';
export type { RequestContextStore } from './lib/context/request-context.store';
export { REQUEST_CONTEXT_KEYS } from './lib/context/request-context.store';
export type {
  CqrsMetricsRecorder,
  CqrsExecutionStatus,
} from './lib/cqrs/cqrs-metrics-recorder.port';
export { CQRS_METRICS_RECORDER } from './lib/cqrs/cqrs-metrics-recorder.port';
export { CqrsInstrumentationInitializer } from './lib/cqrs/cqrs-instrumentation.initializer';
export { AUTHORIZATION_PORT } from './lib/authorization/authorization.port';
export type {
  AccessDecision,
  AccessFilter,
  AuthorizationCapabilities,
  AuthorizationPort,
  CheckRequest,
  Principal,
  RelationInput,
  ResourceRef,
} from './lib/authorization/authorization.port';
export {
  ACCESS_FILTER_TRUNCATED_CODE,
  accessFilterTruncated,
  applyAccessFilter,
} from './lib/authorization/access-filter';
