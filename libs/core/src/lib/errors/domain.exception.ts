// Business failures are raised by domain entities and CQRS handlers, which run inside the api, the
// scheduler (outbox relay → listener → CommandBus) and any future queue consumer. Extending
// HttpException here would put an HTTP status on a failure that, outside the api, nothing maps.
// The transport decides the status: GlobalExceptionFilter maps `kind`, GraphQL reads it directly.
// `malformed` is input the layer could not even parse (→ 400); `validation` is input that parsed
// but broke a rule (→ 422). `unavailable` signals a downstream dependency is unreachable or
// unhealthy (→ 503); it always implies `permanent: false`. Keeping them apart is what lets the
// transport pick the right status.
export type DomainErrorKind =
  'malformed' | 'validation' | 'conflict' | 'not_found' | 'forbidden' | 'unavailable';

export interface DomainViolation {
  readonly path: string;
  readonly code: string;
  // Default English copy — replaced with locale-resolved text when `messageKey` is set.
  readonly message: string;
  readonly messageKey?: string;
  readonly rule?: string;
  readonly constraint?: Record<string, unknown>;
}

export interface DomainExceptionOptions {
  readonly kind?: DomainErrorKind;
  readonly code?: string;
  readonly title?: string;
  readonly messageKey?: string;
  readonly args?: Record<string, unknown>;
  readonly violations: DomainViolation[];
  // A rejected business rule does not become valid by trying again, so consumers that retry
  // (outbox relay, BullMQ processors) must park instead of burning the retry budget. Set false only
  // for a conflict a later attempt could genuinely win.
  readonly permanent?: boolean;
}

export class DomainException extends Error {
  readonly kind: DomainErrorKind;
  readonly code: string;
  readonly title: string;
  readonly messageKey?: string;
  readonly args?: Record<string, unknown>;
  readonly violations: DomainViolation[];
  readonly permanent: boolean;

  constructor(options: DomainExceptionOptions) {
    const code = options.code ?? 'business_rule_violation';
    super(options.violations[0]?.message ?? code);
    this.name = 'DomainException';
    this.kind = options.kind ?? 'validation';
    this.code = code;
    this.title = options.title ?? 'Business rule violation';
    this.messageKey = options.messageKey;
    this.args = options.args;
    this.violations = options.violations;
    // unavailable implies transient infrastructure failure — always retryable.
    this.permanent = options.kind === 'unavailable' ? false : (options.permanent ?? true);
  }
}

export function isDomainException(error: unknown): error is DomainException {
  return error instanceof DomainException;
}
