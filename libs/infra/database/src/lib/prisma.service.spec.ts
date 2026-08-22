import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
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

describe('PrismaService lifecycle cleanup', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      DATABASE_REPLICA_URL: 'postgresql://test:test@replica:5432/test',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('disconnects both clients when replica connection fails during startup', async () => {
    const svc = new PrismaService();
    vi.spyOn(svc.db, '$connect').mockResolvedValue();
    vi.spyOn(svc.dbRead, '$connect').mockRejectedValue(new Error('replica unavailable'));
    const disconnectWrite = vi.spyOn(svc.db, '$disconnect').mockResolvedValue();
    const disconnectRead = vi.spyOn(svc.dbRead, '$disconnect').mockResolvedValue();

    await expect(svc.onModuleInit()).rejects.toThrow('DatabaseModule: failed to connect');
    expect(disconnectWrite).toHaveBeenCalledOnce();
    expect(disconnectRead).toHaveBeenCalledOnce();
  });

  it('attempts replica disconnect even when primary disconnect fails', async () => {
    const svc = new PrismaService();
    vi.spyOn(svc.db, '$disconnect').mockRejectedValue(new Error('primary close failed'));
    const disconnectRead = vi.spyOn(svc.dbRead, '$disconnect').mockResolvedValue();

    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
    expect(disconnectRead).toHaveBeenCalledOnce();
  });
});

describe('PrismaService transaction context', () => {
  it('exposes the transaction client only inside the matching async transaction', async () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    delete process.env['DATABASE_REPLICA_URL'];
    const svc = new PrismaService();
    const txClient = { outboxEvent: { createMany: vi.fn() } };
    vi.spyOn(svc.db, '$transaction').mockImplementationOnce((async (
      callback: (tx: typeof txClient) => Promise<unknown>,
    ) => callback(txClient)) as unknown as typeof svc.db.$transaction);

    expect(svc.currentTransaction).toBeUndefined();
    await svc.transaction(async () => {
      expect(svc.currentTransaction).toBe(txClient);
      await Promise.resolve();
      expect(svc.currentTransaction).toBe(txClient);
    });
    expect(svc.currentTransaction).toBeUndefined();
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

describe('PrismaService — DATABASE_LOG_QUERIES full query debug logging', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    delete process.env['DATABASE_REPLICA_URL'];
    delete process.env['NODE_ENV'];
    delete process.env['DATABASE_LOG_QUERIES'];
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function captureQueryListener(): { listener: QueryListener | undefined } {
    const captured: { listener: QueryListener | undefined } = { listener: undefined };
    vi.spyOn(PrismaClient.prototype, '$on').mockImplementation(((
      event: string,
      cb: QueryListener,
    ) => {
      if (event === 'query') captured.listener = cb;
    }) as typeof PrismaClient.prototype.$on);
    return captured;
  }

  it('logs every query at debug WITH params when enabled outside production', () => {
    process.env['DATABASE_LOG_QUERIES'] = 'true';
    const captured = captureQueryListener();
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    new PrismaService();

    captured.listener?.({
      query: 'SELECT * FROM "User" WHERE "id" = $1',
      params: '["a-real-value"]',
      duration: 3,
    });

    expect(debugSpy).toHaveBeenCalledWith(
      { durationMs: 3, query: 'SELECT * FROM "User" WHERE "id" = $1', params: '["a-real-value"]' },
      'Database query',
    );
  });

  it('does not debug-log any query when DATABASE_LOG_QUERIES is unset', () => {
    const captured = captureQueryListener();
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    new PrismaService();
    captured.listener?.({ query: 'SELECT 1', params: '["x"]', duration: 3 });

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('ignores the flag in production so params never reach a log', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['DATABASE_LOG_QUERIES'] = 'true';
    process.env['DATABASE_URL'] = 'postgresql://user:pass@db:5432/prod';
    process.env['BETTER_AUTH_SECRET'] = 'x'.repeat(32);
    const captured = captureQueryListener();
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    new PrismaService();
    captured.listener?.({ query: 'SELECT 1', params: '["secret"]', duration: 3 });

    expect(debugSpy).not.toHaveBeenCalled();
    // The boot warning must announce that the flag was ignored.
    const warnedIgnore = warnSpy.mock.calls.some((c) =>
      String(c[0]).includes('ignored in production'),
    );
    expect(warnedIgnore).toBe(true);
  });

  it('DATABASE_LOG_QUERIES=false does not enable debug logging (string, not coerced)', () => {
    process.env['DATABASE_LOG_QUERIES'] = 'false';
    const captured = captureQueryListener();
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    new PrismaService();
    captured.listener?.({ query: 'SELECT 1', params: '["x"]', duration: 3 });

    expect(debugSpy).not.toHaveBeenCalled();
  });
});

describe('PrismaService — tenant context', () => {
  const originalEnv = process.env;
  const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90400001';

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function clsStub(organizationId?: string) {
    return {
      isActive: () => true,
      get: (key: string) => (key === 'organizationId' ? organizationId : undefined),
    };
  }

  // withTenantContext opens the transaction on the underlying client directly, not through the
  // db/dbRead getters, so the field is what has to be replaced.
  function stubTransaction(svc: PrismaService, target: '_writeClient' | '_readClient') {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const client = { $executeRaw: executeRaw };
    const transaction = vi
      .fn()
      .mockImplementation((fn: (c: unknown) => Promise<unknown>) => fn(client));
    (svc as unknown as Record<string, unknown>)[target] = { $transaction: transaction };
    return { executeRaw, transaction, client };
  }

  it('reports no tenant context when CLS is absent', () => {
    expect(new PrismaService().hasTenantContext).toBe(false);
  });

  it('reports no tenant context when CLS carries no organization', () => {
    const svc = new PrismaService(clsStub() as never);
    expect(svc.hasTenantContext).toBe(false);
  });

  // Fail closed: running unscoped would hand the caller another tenant's rows on any table whose
  // row-level security policy reads app.current_org_id.
  it('refuses tenant-scoped work when no organization is in context', async () => {
    const svc = new PrismaService(clsStub() as never);

    await expect(svc.withTenantContext(async () => 'never')).rejects.toMatchObject({
      code: 'organization_context_required',
    });
  });

  it('binds the organization before running the callback', async () => {
    const svc = new PrismaService(clsStub(ORG_ID) as never);
    const { executeRaw } = stubTransaction(svc, '_writeClient');

    const order: string[] = [];
    executeRaw.mockImplementation(async () => {
      order.push('bind');
      return 1;
    });

    await svc.withTenantContext(async () => {
      order.push('callback');
    });

    expect(order).toEqual(['bind', 'callback']);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('exposes the transaction client through currentTransaction while it runs', async () => {
    const svc = new PrismaService(clsStub(ORG_ID) as never);
    const { client } = stubTransaction(svc, '_writeClient');

    await svc.withTenantContext(async () => {
      expect(svc.currentTransaction).toBe(client);
    });

    expect(svc.currentTransaction).toBeUndefined();
  });

  it('keeps a read-only unit of work off the primary when a replica exists', async () => {
    process.env['DATABASE_REPLICA_URL'] = 'postgresql://test:test@localhost:5433/test';
    const svc = new PrismaService(clsStub(ORG_ID) as never);
    const read = stubTransaction(svc, '_readClient');
    const write = stubTransaction(svc, '_writeClient');

    await svc.withTenantContext(async () => undefined, { readOnly: true });

    expect(read.transaction).toHaveBeenCalledTimes(1);
    expect(write.transaction).not.toHaveBeenCalled();
  });

  it('sends a read-only unit of work to the primary when no replica is configured', async () => {
    delete process.env['DATABASE_REPLICA_URL'];
    const svc = new PrismaService(clsStub(ORG_ID) as never);
    const write = stubTransaction(svc, '_writeClient');

    await svc.withTenantContext(async () => undefined, { readOnly: true });

    expect(write.transaction).toHaveBeenCalledTimes(1);
  });

  // A write must never join the replica transaction a surrounding read opened, or it would run
  // against a read-only standby.
  it('does not reuse an open read transaction for write work', async () => {
    process.env['DATABASE_REPLICA_URL'] = 'postgresql://test:test@localhost:5433/test';
    const svc = new PrismaService(clsStub(ORG_ID) as never);
    const read = stubTransaction(svc, '_readClient');
    const write = stubTransaction(svc, '_writeClient');

    await svc.withTenantContext(
      async () => {
        await svc.withTenantContext(async () => undefined);
      },
      { readOnly: true },
    );

    expect(read.transaction).toHaveBeenCalledTimes(1);
    expect(write.transaction).toHaveBeenCalledTimes(1);
  });

  it('binds the organization on a plain transaction when one is in context', async () => {
    const svc = new PrismaService(clsStub(ORG_ID) as never);
    const { executeRaw } = stubTransaction(svc, '_writeClient');

    await svc.transaction(async () => undefined);

    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('leaves a plain transaction unbound for system work with no organization', async () => {
    const svc = new PrismaService(clsStub() as never);
    const { executeRaw } = stubTransaction(svc, '_writeClient');

    await svc.transaction(async () => undefined);

    expect(executeRaw).not.toHaveBeenCalled();
  });
});
