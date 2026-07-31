import { describe, it, expect, afterEach, vi } from 'vitest';
import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { DomainException } from '@nestjs-fastify-nx/core';
import { normalizeException } from './global-exception.filter';

describe('normalizeException — transport redaction guard-rail (BE-4)', () => {
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

  it('redacts the same 5xx exception outside production too', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const exception = new HttpException('pg pool exhausted', 500);

    const result = normalizeException(exception);

    expect(result.detail).toBe('Internal Server Error');
  });

  it('redacts a messageKey-carrying 5xx response too', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const exception = new HttpException(
      { messageKey: 'errors.storage.upload_failed', code: 'storage_upload_failed' },
      500,
    );

    const result = normalizeException(exception);

    expect(result.detail).toBe('Internal Server Error');
    expect(result.code).toBe('internal_server_error');
  });

  it('does not redact 4xx HttpExceptions in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const exception = new HttpException('email already registered', HttpStatus.CONFLICT);

    const result = normalizeException(exception);

    expect(result.detail).toBe('email already registered');
  });

  // A domain failure can no longer be misclassified as a 5xx: it carries no status at all, and the
  // filter derives one from `kind`, which only maps to client-correctable codes.
  it.each([
    ['malformed', HttpStatus.BAD_REQUEST],
    ['validation', HttpStatus.UNPROCESSABLE_ENTITY],
    ['conflict', HttpStatus.CONFLICT],
    ['not_found', HttpStatus.NOT_FOUND],
    ['forbidden', HttpStatus.FORBIDDEN],
  ] as const)('maps domain kind %s to %i and never to a 5xx', (kind, status) => {
    vi.stubEnv('NODE_ENV', 'production');

    const result = normalizeException(new DomainException({ kind, violations: [] }));

    expect(result.status).toBe(status);
    expect(result.status).toBeLessThan(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

describe('normalizeException — Prisma error safety-net', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Structural Prisma known-request error (no @prisma/client import needed).
  function prismaError(
    code: string,
    message = 'Unique constraint failed on the fields: (`email`)',
  ) {
    return { name: 'PrismaClientKnownRequestError', code, message };
  }

  it('maps P2002 (unique constraint) to 409 conflict', () => {
    const result = normalizeException(prismaError('P2002'));
    expect(result.status).toBe(HttpStatus.CONFLICT);
    expect(result.code).toBe('conflict');
  });

  it('maps P2025 (record not found) to 404', () => {
    const result = normalizeException(prismaError('P2025'));
    expect(result.status).toBe(HttpStatus.NOT_FOUND);
    expect(result.code).toBe('not_found');
  });

  it('maps P2003 (fk violation) to 409 and P2023 (bad column data) to 400', () => {
    expect(normalizeException(prismaError('P2003')).status).toBe(HttpStatus.CONFLICT);
    expect(normalizeException(prismaError('P2023')).status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('maps P2028/P2024 (tx + pool timeout) to 503', () => {
    expect(normalizeException(prismaError('P2028')).status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(normalizeException(prismaError('P2024')).status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('never leaks the raw Prisma message (schema details) in the mapped detail', () => {
    const result = normalizeException(
      prismaError('P2002', 'Unique constraint failed on the fields: (`users.email`)'),
    );
    expect(JSON.stringify(result)).not.toMatch(/users\.email|constraint failed/i);
  });

  it('falls through to a redacted 500 for an unmapped Prisma code in every environment', () => {
    const result = normalizeException(prismaError('P2099', 'some internal prisma detail'));
    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(result)).not.toMatch(/internal prisma detail/);
  });

  it('redacts Prisma errors without a Pxxxx code in development too', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const result = normalizeException({
      name: 'PrismaClientUnknownRequestError',
      message: 'FATAL: database "private_prod" does not exist at db.internal:5432',
    });
    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(result)).not.toMatch(/private_prod|db\.internal|5432/);
  });

  it('does not misclassify a non-Prisma object that merely has a code', () => {
    const result = normalizeException({ code: 'P2002', message: 'not really prisma' });
    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
