import { describe, it, expect } from 'vitest';
import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import type { MercuriusContext } from 'mercurius';
import { createGraphqlErrorFormatter } from './graphql-error-formatter';

// defaultErrorFormatter logs through ctx.reply.log — a stub is enough, nothing else is touched.
const ctx = { reply: { log: { info: () => undefined } } } as unknown as MercuriusContext;

function format(isProduction: boolean, ...errors: GraphQLError[]) {
  const formatter = createGraphqlErrorFormatter(isProduction);
  return formatter({ data: null, errors }, ctx);
}

function messagesOf(result: ReturnType<ReturnType<typeof createGraphqlErrorFormatter>>) {
  return (result.response.errors ?? []).map((e) => e.message);
}

describe('createGraphqlErrorFormatter', () => {
  it('masks an unexpected failure in production', () => {
    const leaky = new GraphQLError('connect ECONNREFUSED 10.0.0.5:5432 (postgres)', {
      originalError: new Error('connect ECONNREFUSED 10.0.0.5:5432 (postgres)'),
      path: ['users'],
    });

    const result = format(true, leaky);

    expect(messagesOf(result)).toEqual(['Internal server error']);
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|postgres|10\.0\.0\.5/);
  });

  it('keeps the raw message outside production so the failure is debuggable', () => {
    const leaky = new GraphQLError('connect ECONNREFUSED 10.0.0.5:5432 (postgres)', {
      originalError: new Error('connect ECONNREFUSED 10.0.0.5:5432 (postgres)'),
    });

    expect(messagesOf(format(false, leaky))).toEqual([
      'connect ECONNREFUSED 10.0.0.5:5432 (postgres)',
    ]);
  });

  it('leaves a deliberate 4xx alone — it was raised for the client to read', () => {
    const forbidden = new GraphQLError('Insufficient permissions', {
      originalError: new ForbiddenException('Insufficient permissions'),
    });
    const domain = new GraphQLError('User not found', {
      originalError: new BusinessRuleException({
        status: HttpStatus.NOT_FOUND,
        code: 'user_not_found',
        violations: [{ path: 'userId', code: 'not_found', message: 'User not found' }],
      }),
    });

    expect(messagesOf(format(true, forbidden, domain))).toEqual([
      'Insufficient permissions',
      'User not found',
    ]);
  });

  it('masks a 5xx HttpException — the status is deliberate, the message is not', () => {
    const internal = new GraphQLError('Storage upload failed: bucket acl denied', {
      originalError: new HttpException('Storage upload failed: bucket acl denied', 500),
    });

    expect(messagesOf(format(true, internal))).toEqual(['Internal server error']);
  });

  it('leaves a graphql-level error alone — it describes the query the client sent', () => {
    // No originalError: syntax/validation errors say nothing about our internals.
    const validation = new GraphQLError('Cannot query field "nope" on type "UserType".');

    expect(messagesOf(format(true, validation))).toEqual([
      'Cannot query field "nope" on type "UserType".',
    ]);
  });

  it('preserves path so a masked error still says which field failed', () => {
    const leaky = new GraphQLError('internal detail', {
      originalError: new Error('internal detail'),
      path: ['users', 0, 'email'],
    });

    const [error] = format(true, leaky).response.errors ?? [];
    expect(error?.message).toBe('Internal server error');
    expect(error?.path).toEqual(['users', 0, 'email']);
  });

  it('masks only the internal error when errors are mixed', () => {
    const leaky = new GraphQLError('internal detail', {
      originalError: new Error('internal detail'),
    });
    const forbidden = new GraphQLError('Insufficient permissions', {
      originalError: new ForbiddenException('Insufficient permissions'),
    });

    expect(messagesOf(format(true, leaky, forbidden))).toEqual([
      'Internal server error',
      'Insufficient permissions',
    ]);
  });
});
