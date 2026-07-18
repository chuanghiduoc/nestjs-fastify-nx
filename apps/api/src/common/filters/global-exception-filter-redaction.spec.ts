import { describe, it, expect, afterEach, vi } from 'vitest';
import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import { normalizeException } from './global-exception.filter';

describe('normalizeException — production redaction guard-rail (BE-4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redacts a 5xx HttpException without messageKey in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const exception = new HttpException(
      'pg pool exhausted: connection refused at 10.0.0.5:5432',
      500,
    );

    const result = normalizeException(exception);

    expect(result.detail).toBe('Internal Server Error');
    expect(result.detail).not.toMatch(/10\.0\.0\.5|pg pool/);
  });

  it('redacts a plain-string 5xx HttpException response in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const exception = new InternalServerErrorException(
      'stack: at Object.<anonymous> (/app/src/x.ts:12)',
    );

    const result = normalizeException(exception);

    expect(result.detail).toBe('Internal Server Error');
  });

  it('does not redact the same 5xx exception outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const exception = new HttpException('pg pool exhausted', 500);

    const result = normalizeException(exception);

    expect(result.detail).toBe('pg pool exhausted');
  });

  it('preserves a messageKey-carrying 5xx response even in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const exception = new HttpException(
      { messageKey: 'errors.storage.upload_failed', code: 'storage_upload_failed' },
      500,
    );

    const result = normalizeException(exception);

    expect(result.detail).toBe('errors.storage.upload_failed');
    expect(result.code).toBe('storage_upload_failed');
  });

  it('does not redact 4xx HttpExceptions in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const exception = new HttpException('email already registered', HttpStatus.CONFLICT);

    const result = normalizeException(exception);

    expect(result.detail).toBe('email already registered');
  });

  it('leaves BusinessRuleException behavior untouched in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const exception = new BusinessRuleException({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_business_failure',
      messageKey: 'errors.business.internal_failure',
      violations: [],
    });

    const result = normalizeException(exception);

    expect(result.detail).toBe('errors.business.internal_failure');
    expect(result.code).toBe('internal_business_failure');
  });
});
