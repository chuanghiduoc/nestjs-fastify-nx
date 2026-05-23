import { HttpException, HttpStatus } from '@nestjs/common';

export interface BusinessRuleViolation {
  readonly path: string;
  readonly code: string;
  // Default English copy — GlobalExceptionFilter overrides this with the locale-resolved text when `messageKey` is set.
  readonly message: string;
  // i18n key (e.g. `errors.upload.mime_not_allowed`) the filter uses to translate `message` per request locale. Optional for backwards-compat with violations that ship literal copy.
  readonly messageKey?: string;
  readonly rule?: string;
  readonly constraint?: Record<string, unknown>;
  readonly received?: unknown;
}

export interface BusinessRuleExceptionOptions {
  // Defaults to 422; use 409 for conflicts that retry could resolve.
  readonly status?: HttpStatus;
  readonly code?: string;
  // Either a literal English title or an i18n key — the filter translates dotted strings.
  readonly title?: string;
  // i18n key for the top-level `detail` field. Translated by GlobalExceptionFilter.
  readonly messageKey?: string;
  // Interpolation arguments for top-level `messageKey`/`title` translations.
  readonly args?: Record<string, unknown>;
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
    super(
      {
        statusCode: status,
        code,
        title,
        messageKey: options.messageKey,
        args: options.args,
        errors: options.violations,
      },
      status,
    );
    this.code = code;
    this.violations = options.violations;
  }
}
