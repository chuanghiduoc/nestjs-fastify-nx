import { HttpStatus, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import type { ValidationError, ValidationPipeOptions } from '@nestjs/common';
import { ERROR_CODES, type ValidationErrorItemDto } from '@nestjs-fastify-nx/contracts';
import {
  I18N_KEYS,
  mapConstraintToI18nKey,
  VALIDATION_CONSTRAINT_KEYS,
} from '@nestjs-fastify-nx/infra-i18n';

const SENSITIVE_FIELD_PATTERN = /(password|secret|token|authorization|cookie|credit[_-]?card|ssn)/i;
const REDACTED = '[REDACTED]';

export class ProblemDetailsValidationPipe extends ValidationPipe {
  constructor(options: ValidationPipeOptions = {}) {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      ...options,
      exceptionFactory: (validationErrors: ValidationError[] = []) => {
        const errors = flattenValidationErrors(validationErrors);
        return new UnprocessableEntityException({
          code: ERROR_CODES.VALIDATION_FAILED,
          // GlobalExceptionFilter rewrites title/message from these keys based on the resolved locale.
          title: I18N_KEYS.validation.failed_title,
          message: I18N_KEYS.validation.failed_detail,
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
          // English message from class-validator — used as fallback when locale lookup misses.
          message,
          messageKey: mapConstraintToI18nKey(rule),
          rule,
          constraint: extractConstraintArgs(err, rule),
          received: redactIfSensitive(path, rule, err.value),
        });
      }
    }

    if (err.children && err.children.length > 0) {
      flat.push(...flattenValidationErrors(err.children, path));
    }
  }

  return flat;
}

// Numeric index uses bracket notation to avoid ambiguity with property names that look like numbers.
function appendPath(parent: string, property: string): string {
  if (!parent) return property;
  return /^\d+$/.test(property) ? `${parent}[${property}]` : `${parent}.${property}`;
}

function extractConstraintArgs(
  err: ValidationError,
  rule: string,
): Record<string, unknown> | undefined {
  const ctx = (err as { contexts?: Record<string, unknown> }).contexts?.[rule];
  if (ctx && typeof ctx === 'object') {
    return ctx as Record<string, unknown>;
  }
  return undefined;
}

function redactIfSensitive(path: string, rule: string, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  // A whitelist-rejected field is one the client sent that the DTO never declared — echoing its
  // value back has no diagnostic use and can leak a secret nested under an unrecognised key.
  if (rule === 'whitelistValidation') return undefined;
  if (SENSITIVE_FIELD_PATTERN.test(path)) return REDACTED;
  // Never echo a raw object/array: field-name redaction can't see secrets nested inside it.
  if (typeof value === 'object') return undefined;
  if (typeof value === 'string' && value.length > 200) {
    return `${value.slice(0, 200)}…`;
  }
  return value;
}

// class-validator decorator name → stable error code used by frontend for branching.
// Mirrors VALIDATION_CONSTRAINT_KEYS in @nestjs-fastify-nx/infra-i18n — codes are short snake_case slugs, i18n keys are dotted paths.
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

// Re-export so callers don't need to import both modules.
export { VALIDATION_CONSTRAINT_KEYS };
