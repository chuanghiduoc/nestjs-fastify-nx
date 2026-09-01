import { HttpStatus, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import type { ValidationError, ValidationPipeOptions } from '@nestjs/common';
import {
  ERROR_CODES,
  validatorToCode,
  type ValidationErrorItemDto,
} from '@nestjs-fastify-nx/contracts';
import { mapConstraintToI18nKey, VALIDATION_CONSTRAINT_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import { I18N_KEYS } from '@nestjs-fastify-nx/contracts';

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

function mapValidatorToCode(rule: string): string {
  return validatorToCode(rule);
}

// Re-export so callers don't need to import both modules.
export { VALIDATION_CONSTRAINT_KEYS };
