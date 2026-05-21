import { HttpException, HttpStatus } from '@nestjs/common';

export interface BusinessRuleViolation {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly rule?: string;
  readonly constraint?: Record<string, unknown>;
  readonly received?: unknown;
}

export interface BusinessRuleExceptionOptions {
  // Defaults to 422; use 409 for conflicts that retry could resolve.
  readonly status?: HttpStatus;
  readonly code?: string;
  readonly title?: string;
  readonly violations: BusinessRuleViolation[];
}

// Same errors[] shape as validation so the frontend can share one rendering path.
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
