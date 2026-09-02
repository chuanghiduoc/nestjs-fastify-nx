import { describe, it, expect } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { GraphQLError, Source } from 'graphql';
import type { MercuriusContext } from 'mercurius';
import { createGraphqlErrorFormatter } from './graphql-error-formatter';

// defaultErrorFormatter logs through ctx.reply.log — a stub is enough, nothing else is touched.
const ctx = { reply: { log: { info: () => undefined } } } as unknown as MercuriusContext;

function format(...errors: GraphQLError[]) {
  const formatter = createGraphqlErrorFormatter();
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

    const result = format(leaky);

    expect(messagesOf(result)).toEqual(['Internal server error']);
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|postgres|10\.0\.0\.5/);
  });

  it('masks the raw message in every environment', () => {
    const leaky = new GraphQLError('connect ECONNREFUSED 10.0.0.5:5432 (postgres)', {
      originalError: new Error('connect ECONNREFUSED 10.0.0.5:5432 (postgres)'),
    });

    expect(messagesOf(format(leaky))).toEqual(['Internal server error']);
  });

  it('leaves a deliberate 4xx alone — it was raised for the client to read', () => {
    const forbidden = new GraphQLError('Insufficient permissions', {
      originalError: new ForbiddenException('Insufficient permissions'),
    });
    const domain = new GraphQLError('User not found', {
      originalError: new DomainException({
        kind: 'not_found',
        code: 'user_not_found',
        violations: [{ path: 'userId', code: 'not_found', message: 'User not found' }],
      }),
    });

    expect(messagesOf(format(forbidden, domain))).toEqual([
      'Insufficient permissions',
      'User not found',
    ]);
  });

  it('masks a 5xx HttpException — the status is deliberate, the message is not', () => {
    const internal = new GraphQLError('Storage upload failed: bucket acl denied', {
      originalError: new HttpException('Storage upload failed: bucket acl denied', 500),
    });

    expect(messagesOf(format(internal))).toEqual(['Internal server error']);
  });

  it('drops internal GraphQL extensions together with the message', () => {
    const internal = new GraphQLError('database failed', {
      originalError: new Error('database failed'),
      extensions: {
        code: 'PRISMA_P1001',
        stacktrace: ['at prisma.user.findUnique (/app/repository.ts:42)'],
        cause: { host: 'database.internal', port: 5432 },
      },
    });

    const result = format(internal);
    const serialized = JSON.stringify(result);

    expect(result.response.errors?.[0]?.extensions).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(serialized).not.toMatch(/PRISMA|stacktrace|database\.internal|repository/);
  });

  it('leaves a graphql-level error alone — it describes the query the client sent', () => {
    // No originalError: syntax/validation errors say nothing about our internals.
    const validation = new GraphQLError('Cannot query field "nope" on type "UserType".');

    expect(messagesOf(format(validation))).toEqual([
      'Cannot query field "nope" on type "UserType".',
    ]);
  });

  it('unwraps a mercurius validation error into a 400 carrying the client-facing messages', () => {
    const nested = [
      new GraphQLError('Cannot query field "nope" on type "UserType".', {
        positions: [8],
        source: new Source('{ me { nope } }'),
      }),
    ];
    const wrapped = new GraphQLError('Graphql validation error', {
      originalError: Object.assign(new Error('Graphql validation error'), {
        code: 'MER_ERR_GQL_VALIDATION',
        statusCode: 400,
        errors: nested,
      }),
    });

    const result = format(wrapped);

    expect(result.statusCode).toBe(400);
    expect(messagesOf(result)).toEqual(['Cannot query field "nope" on type "UserType".']);
    expect(result.response.errors?.[0]?.locations).toEqual([{ line: 1, column: 9 }]);
  });

  it('still masks a mercurius error that reports a server-side status', () => {
    const wrapped = new GraphQLError('schema build failed at /app/schema.ts', {
      originalError: Object.assign(new Error('schema build failed at /app/schema.ts'), {
        code: 'MER_ERR_INVALID_OPTS',
        statusCode: 500,
      }),
    });

    const result = format(wrapped);

    expect(messagesOf(result)).toEqual(['Internal server error']);
    expect(JSON.stringify(result)).not.toContain('schema.ts');
  });

  it('preserves path so a masked error still says which field failed', () => {
    const leaky = new GraphQLError('internal detail', {
      originalError: new Error('internal detail'),
      path: ['users', 0, 'email'],
    });

    const [error] = format(leaky).response.errors ?? [];
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

    expect(messagesOf(format(leaky, forbidden))).toEqual([
      'Internal server error',
      'Insufficient permissions',
    ]);
  });
});
