import { HttpException, HttpStatus } from '@nestjs/common';

export interface BusinessRuleViolation {
  /** Path to the offending field/resource — e.g. `items[0]`, `coupon_code`, `email`. */
  readonly path: string;
  /** Stable, machine-readable code — e.g. `insufficient_stock`, `already_taken`, `expired`. */
  readonly code: string;
  /** Default human-readable message. */
  readonly message: string;
  /** Optional rule name surfaced to the client (rarely useful for business rules; mostly for parity with validation). */
  readonly rule?: string;
  /** Optional constraint context — e.g. `{ available: 12 }`, `{ expiresAt: '...' }`. */
  readonly constraint?: Record<string, unknown>;
  /** Optional received value — surface only if non-sensitive. */
  readonly received?: unknown;
}

export interface BusinessRuleExceptionOptions {
  /**
   * HTTP status to return. Defaults to 422 (Unprocessable Entity) which is the
   * standard for "syntactically valid request that violates a business rule".
   * Use 409 (Conflict) for state conflicts that retry could resolve.
   */
  readonly status?: HttpStatus;
  /** Top-level error code for the Problem Details envelope (defaults to `business_rule_violation`). */
  readonly code?: string;
  /** Top-level human-readable summary (defaults to "Business rule violation"). */
  readonly title?: string;
  /** Per-violation details — populates `errors[]` in the response. */
  readonly violations: BusinessRuleViolation[];
}

/**
 * Throw when a request is well-formed but violates a domain rule. Translated to
 * a Problem Details payload with the same `errors[]` shape as validation, so
 * the frontend can use a single rendering path for both schema and business
 * violations.
 */
export class BusinessRuleException extends HttpException {
  readonly code: string;
  readonly violations: BusinessRuleViolation[];

  constructor(options: BusinessRuleExceptionOptions) {
    const status = options.status ?? HttpStatus.UNPROCESSABLE_ENTITY;
    const code = options.code ?? 'business_rule_violation';
    const title = options.title ?? 'Business rule violation';
    super({ statusCode: status, code, title, errors: options.violations }, status);
    this.code = code;
    this.violations = options.violations;
  }
}
