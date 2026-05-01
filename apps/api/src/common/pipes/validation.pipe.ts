import { HttpStatus, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import type { ValidationError, ValidationPipeOptions } from '@nestjs/common';
import { ERROR_CODES, type ValidationErrorItemDto } from '@nestjs-fastify-nx/contracts';

const SENSITIVE_FIELD_PATTERN = /(password|secret|token|authorization|cookie|credit[_-]?card|ssn)/i;
const REDACTED = '[REDACTED]';

/**
 * Drop-in replacement for Nest's `ValidationPipe` that converts class-validator's
 * recursive `ValidationError` tree into a flat `ValidationErrorItemDto[]`
 * payload aligned with RFC 9457 Problem Details + the project-wide error model
 * in `apps/api/src/common/errors`.
 *
 * Behavioural contract:
 *  - Throws `UnprocessableEntityException` (HTTP 422) — RFC 9110 says 400 is for
 *    malformed syntax, 422 for "well-formed but semantically invalid".
 *  - The thrown response object carries `code: 'validation_failed'` and
 *    `errors: ValidationErrorItemDto[]`, which `GlobalExceptionFilter` passes
 *    straight through into the Problem Details body.
 *  - Each error item has a stable `code` (e.g. `too_short`, `out_of_range`,
 *    `not_an_email`) so the frontend can switch on it without parsing English.
 *  - `received` is included for diagnostics on non-sensitive fields; values for
 *    paths matching `password`, `token`, `secret`, etc. are redacted.
 */
export class ProblemDetailsValidationPipe extends ValidationPipe {
  constructor(options: ValidationPipeOptions = {}) {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // class-validator's "stopAtFirstError: true" is tempting but produces a
      // worse UX — frontends prefer surfacing every offending field at once.
      stopAtFirstError: false,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      ...options,
      exceptionFactory: (validationErrors: ValidationError[] = []) => {
        const errors = flattenValidationErrors(validationErrors);
        return new UnprocessableEntityException({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: ERROR_CODES.VALIDATION_FAILED,
          title: 'Validation failed',
          message: 'One or more fields did not pass validation.',
          errors,
        });
      },
    });
  }
}

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationErrorItemDto[] {
  const flat: ValidationErrorItemDto[] = [];

  for (const err of errors) {
    const path = appendPath(parentPath, err.property);

    if (err.constraints) {
      for (const [rule, message] of Object.entries(err.constraints)) {
        flat.push({
          path,
          code: mapValidatorToCode(rule),
          message,
          rule,
          constraint: extractConstraintArgs(err, rule),
          received: redactIfSensitive(path, err.value),
        });
      }
    }

    if (err.children && err.children.length > 0) {
      flat.push(...flattenValidationErrors(err.children, path));
    }
  }

  return flat;
}

// Object property → `parent.child`; numeric index → `parent[0]`. Using bracket
// notation for arrays keeps the path unambiguous when a property name happens
// to look like a number.
function appendPath(parent: string, property: string): string {
  if (!parent) return property;
  return /^\d+$/.test(property) ? `${parent}[${property}]` : `${parent}.${property}`;
}

// class-validator stamps the constraint args onto a hidden `contexts` map only
// when `@ValidatorConstraint` is used with `Validate(... , { context })`. For
// the built-in decorators (`@Min`, `@MaxLength`, `@IsEnum`, …) the parameters
// are baked into the message via `$constraint1` placeholders. We can't recover
// the arg values reliably across versions, but we can surface what's there.
function extractConstraintArgs(
  err: ValidationError,
  rule: string,
): Record<string, unknown> | undefined {
  const ctx = (err as ValidationError & { contexts?: Record<string, unknown> }).contexts?.[rule];
  if (ctx && typeof ctx === 'object') {
    return ctx as Record<string, unknown>;
  }
  return undefined;
}

function redactIfSensitive(path: string, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (SENSITIVE_FIELD_PATTERN.test(path)) return REDACTED;
  // Echoing back huge payloads (uploads, big arrays) inflates the error body.
  // Cap echoed strings at a reasonable length so the response stays small.
  if (typeof value === 'string' && value.length > 200) {
    return `${value.slice(0, 200)}…`;
  }
  return value;
}

// class-validator decorator name → stable, language-agnostic error code.
// Codes are deliberately coarse: the frontend should use them for branching
// (e.g. show "email already taken" vs "format invalid"), while the human
// `message` covers nuance.
const VALIDATOR_TO_CODE: Record<string, string> = {
  isDefined: 'required',
  isNotEmpty: 'required',
  isOptional: 'required',

  isString: 'wrong_type',
  isNumber: 'wrong_type',
  isInt: 'wrong_type',
  isBoolean: 'wrong_type',
  isArray: 'wrong_type',
  isObject: 'wrong_type',
  isDate: 'wrong_type',
  isEnum: 'invalid_enum_value',

  isEmail: 'invalid_email',
  isUrl: 'invalid_url',
  isUuid: 'invalid_uuid',
  isPhoneNumber: 'invalid_phone',
  isMobilePhone: 'invalid_phone',
  matches: 'pattern_mismatch',
  isAlpha: 'pattern_mismatch',
  isAlphanumeric: 'pattern_mismatch',
  isAscii: 'pattern_mismatch',
  isCreditCard: 'invalid_credit_card',
  isHexColor: 'pattern_mismatch',
  isJWT: 'pattern_mismatch',

  min: 'out_of_range',
  max: 'out_of_range',
  isPositive: 'out_of_range',
  isNegative: 'out_of_range',
  minDate: 'out_of_range',
  maxDate: 'out_of_range',

  minLength: 'too_short',
  maxLength: 'too_long',
  length: 'wrong_length',
  arrayMinSize: 'too_short',
  arrayMaxSize: 'too_long',

  isIn: 'invalid_enum_value',
  isNotIn: 'forbidden_value',

  whitelistValidation: 'unknown_field',
};

function mapValidatorToCode(rule: string): string {
  return VALIDATOR_TO_CODE[rule] ?? 'invalid_value';
}
