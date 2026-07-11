import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService, isSlowQuery } from './prisma.service';

type QueryListener = (event: { query: string; params: string; duration: number }) => void;

/**
 * Unit tests for the two-client design in PrismaService.
 * These run without a real database — only the structural property is tested:
 * dbRead aliases to db when no replica URL is set, and diverges when
 * DATABASE_REPLICA_URL is provided. Prisma constructors accept the strings
 * but make no network calls until $connect() is invoked.
 */
describe('PrismaService — client aliasing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('dbRead aliases to db when DATABASE_REPLICA_URL is unset', () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    delete process.env['DATABASE_REPLICA_URL'];

    const svc = new PrismaService();

    // Both getters must return the same object reference — no second client created.
    expect(svc.dbRead).toBe(svc.db);
    expect(svc.hasReplica).toBe(false);
  });

  it('dbRead is a distinct client when DATABASE_REPLICA_URL is set', () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['DATABASE_REPLICA_URL'] = 'postgresql://test:test@replica:5432/test';

    const svc = new PrismaService();

    // Two separate PrismaClient instances — routing diverges.
    expect(svc.dbRead).not.toBe(svc.db);
    expect(svc.hasReplica).toBe(true);
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env['DATABASE_URL'];

    expect(() => new PrismaService()).toThrow('DATABASE_URL is required');
  });

  it('dbRead aliases to db when DATABASE_REPLICA_URL is an empty string', () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    // dotenv loads KEY= as "" which is not undefined — trim() must reduce it to falsy.
    process.env['DATABASE_REPLICA_URL'] = '';

    const svc = new PrismaService();

    expect(svc.dbRead).toBe(svc.db);
    expect(svc.hasReplica).toBe(false);
  });
});

describe('isSlowQuery', () => {
  it('is false when duration is at or below the threshold', () => {
    expect(isSlowQuery(200, 200)).toBe(false);
    expect(isSlowQuery(150, 200)).toBe(false);
  });

  it('is true when duration exceeds the threshold', () => {
    expect(isSlowQuery(201, 200)).toBe(true);
  });
});

describe('PrismaService — slow query logging', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    delete process.env['DATABASE_REPLICA_URL'];
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // Spying on the prototype captures the listener the constructor registers via
  // `this._writeClient.$on('query', ...)`, without reaching into PrismaService internals.
  function captureQueryListener(): { listener: QueryListener | undefined } {
    const captured: { listener: QueryListener | undefined } = { listener: undefined };
    vi.spyOn(PrismaClient.prototype, '$on').mockImplementation(
      // Cast matches the multi-overload $on signature — only the 'query' event is exercised here.
      ((event: string, cb: QueryListener) => {
        if (event === 'query') captured.listener = cb;
      }) as typeof PrismaClient.prototype.$on,
    );
    return captured;
  }

  it('warns with duration + query template (never params) when the query exceeds the threshold', () => {
    process.env['DATABASE_SLOW_QUERY_MS'] = '50';
    const captured = captureQueryListener();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    new PrismaService();

    expect(captured.listener).toBeDefined();
    captured.listener?.({
      query: 'SELECT * FROM "User" WHERE "id" = $1',
      params: '["secret-value"]',
      duration: 120,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      { durationMs: 120, query: 'SELECT * FROM "User" WHERE "id" = $1' },
      'Slow database query detected',
    );
    const loggedPayload = warnSpy.mock.calls[0]?.[0];
    expect(JSON.stringify(loggedPayload)).not.toContain('secret-value');
  });

  it('does not warn when the query stays under the threshold', () => {
    process.env['DATABASE_SLOW_QUERY_MS'] = '200';
    const captured = captureQueryListener();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    new PrismaService();

    captured.listener?.({ query: 'SELECT 1', params: '[]', duration: 5 });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('defaults the threshold to 200ms when DATABASE_SLOW_QUERY_MS is unset', () => {
    delete process.env['DATABASE_SLOW_QUERY_MS'];
    const captured = captureQueryListener();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    new PrismaService();

    captured.listener?.({ query: 'SELECT 1', params: '[]', duration: 199 });
    expect(warnSpy).not.toHaveBeenCalled();

    captured.listener?.({ query: 'SELECT 1', params: '[]', duration: 201 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
