import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

const queueInstances = vi.hoisted(
  () =>
    [] as Array<{
      name: string;
      close: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }>,
);

// Stand-in for @bull-board/fastify that keeps the two traits this suite exercises: routes live in
// an encapsulated child scope, and the adapter installs its own error handler there. The real
// wiring (@bull-board/ui assets, view engine) is covered by the e2e spec.
vi.mock('@bull-board/api', () => ({
  createBullBoard: vi.fn(({ serverAdapter }: { serverAdapter: { setErrorHandler: unknown } }) => {
    (serverAdapter as { setErrorHandler: (h: unknown) => unknown }).setErrorHandler(() => ({
      status: 500,
      body: { error: 'Internal server error' },
    }));
    return {};
  }),
}));
vi.mock('@bull-board/api/bullMQAdapter', () => {
  function BullMQAdapter(q: unknown) {
    return { queue: q };
  }
  return { BullMQAdapter };
});
vi.mock('@bull-board/fastify', () => {
  class FastifyAdapter {
    private errorHandler: ((error: unknown) => { status: number; body: unknown }) | undefined;
    setBasePath() {
      return this;
    }
    setErrorHandler(handler: (error: unknown) => { status: number; body: unknown }) {
      this.errorHandler = handler;
      return this;
    }
    registerPlugin() {
      return (instance: FastifyInstance, _opts: unknown, done: () => void) => {
        instance.get('/', async () => ({ board: 'ok' }));
        instance.get('/static/app.js', async () => 'console.log(1)');
        instance.get('/api/queues', async () => {
          throw Object.assign(new Error('redis down'), { code: 'ECONNREFUSED' });
        });
        const handler = this.errorHandler;
        instance.setErrorHandler((error, _request, reply) => {
          const response = handler?.(error) ?? { status: 500, body: {} };
          return reply.status(response.status || 500).send(response.body);
        });
        done();
      };
    }
  }
  return { FastifyAdapter };
});
vi.mock('bullmq', () => {
  function Queue(name: string) {
    const queue = {
      name,
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    queueInstances.push(queue);
    return queue;
  }
  return { Queue };
});

import {
  createBullBoardPlugin,
  createProblemDetailsErrorHandler,
  parseBasicAuth,
  recordAuthFailure,
} from './create-bull-board-plugin';

const BASE_PATH = '/api/admin/queues';

function makeRedis(overrides: Partial<Redis> = {}): Redis {
  let calls = 0;
  return {
    eval: vi.fn(async () => {
      calls += 1;
      return [calls, 60_000];
    }),
    ...overrides,
  } as unknown as Redis;
}

function baseOpts(redis: Redis) {
  return {
    user: 'admin',
    password: 'secret',
    basePath: BASE_PATH,
    redisHost: 'localhost',
    redisPort: 6380,
    queuePrefix: 'bull',
    redis,
  };
}

function authHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function buildApp(redis: Redis, opts: Partial<ReturnType<typeof baseOpts>> = {}) {
  const app = Fastify({ logger: false });
  await app.register(createBullBoardPlugin({ ...baseOpts(redis), ...opts }));
  await app.ready();
  return app;
}

describe('createProblemDetailsErrorHandler', () => {
  const originalEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
    vi.restoreAllMocks();
  });

  it('preserves an RFC 9457 error that carries `status` but no `statusCode`', () => {
    const handler = createProblemDetailsErrorHandler();
    const result = handler({
      type: '/errors/rate-limited',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Rate limit exceeded. Try again in 42 seconds.',
      code: 'rate_limited',
    });

    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({
      status: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded. Try again in 42 seconds.',
      code: 'rate_limited',
      type: '/errors/rate-limited',
    });
  });

  it('honours `statusCode` on a Fastify-style error', () => {
    const handler = createProblemDetailsErrorHandler();
    const result = handler(Object.assign(new Error('nope'), { statusCode: 503 }));

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      status: 503,
      title: 'Service Unavailable',
      detail: 'nope',
      code: 'service_unavailable',
    });
  });

  it('maps a FST_ERR_* parser failure to its documented status and code', () => {
    const handler = createProblemDetailsErrorHandler();
    const result = handler(
      Object.assign(new Error('Body is not valid JSON'), {
        code: 'FST_ERR_CTP_INVALID_JSON_BODY',
        statusCode: 400,
      }),
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ status: 400, code: 'bad_request' });
  });

  it('falls back to 500 for an unclassified error', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const handler = createProblemDetailsErrorHandler();
    const result = handler(new Error('boom'));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      status: 500,
      title: 'Internal Server Error',
      detail: 'boom',
      code: 'internal_server_error',
    });
  });

  it('falls back to 500 for a null/undefined error', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const handler = createProblemDetailsErrorHandler();

    expect(handler(null).status).toBe(500);
    expect(handler(undefined).status).toBe(500);
  });

  it('does not adopt a non-FST library code on a 5xx', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const handler = createProblemDetailsErrorHandler();
    const result = handler(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    expect(result.body.code).toBe('internal_server_error');
  });

  it('masks 5xx detail in production but keeps 4xx detail intact', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    process.env['NODE_ENV'] = 'production';
    const handler = createProblemDetailsErrorHandler();

    expect(handler(new Error('pg: password authentication failed')).body.detail).toBe(
      'Internal Server Error',
    );
    expect(
      handler({ status: 429, title: 'Too Many Requests', detail: 'slow down' }).body.detail,
    ).toBe('slow down');
  });

  it('logs and reports 5xx only', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const handler = createProblemDetailsErrorHandler();

    handler({ status: 404, title: 'Not Found', code: 'not_found' });
    expect(logSpy).not.toHaveBeenCalled();

    handler(new Error('boom'));
    expect(logSpy).toHaveBeenCalledOnce();
  });
});

describe('parseBasicAuth', () => {
  it('returns undefined for a missing or non-Basic header', () => {
    expect(parseBasicAuth(undefined)).toBeUndefined();
    expect(parseBasicAuth('')).toBeUndefined();
    expect(parseBasicAuth('Bearer abc')).toBeUndefined();
    expect(parseBasicAuth(123)).toBeUndefined();
  });

  it('splits on the first colon so colons in the password survive', () => {
    expect(parseBasicAuth(authHeader('admin', 'a:b:c'))).toEqual({
      user: 'admin',
      password: 'a:b:c',
    });
  });

  it('treats a payload without a colon as a user with an empty password', () => {
    const header = `Basic ${Buffer.from('admin').toString('base64')}`;
    expect(parseBasicAuth(header)).toEqual({ user: 'admin', password: '' });
  });

  it('does not throw on non-base64 garbage', () => {
    expect(() => parseBasicAuth('Basic !!!not-base64!!!')).not.toThrow();
  });
});

describe('recordAuthFailure', () => {
  it('returns the counter and remaining window', async () => {
    const redis = { eval: vi.fn().mockResolvedValue([3, 42_000]) } as unknown as Redis;
    await expect(recordAuthFailure(redis, '10.0.0.1')).resolves.toEqual({
      count: 3,
      ttlMs: 42_000,
    });
  });

  it('accepts string replies from the Redis client', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(['3', '42000']) } as unknown as Redis;
    await expect(recordAuthFailure(redis, '10.0.0.1')).resolves.toEqual({
      count: 3,
      ttlMs: 42_000,
    });
  });

  it('clamps a negative TTL (key without expiry) to zero', async () => {
    const redis = { eval: vi.fn().mockResolvedValue([3, -1]) } as unknown as Redis;
    await expect(recordAuthFailure(redis, '10.0.0.1')).resolves.toEqual({ count: 3, ttlMs: 0 });
  });

  it('throws when the counter reply is not numeric', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(['nope', 1]) } as unknown as Redis;
    await expect(recordAuthFailure(redis, '10.0.0.1')).rejects.toThrow(
      /Unexpected auth-failure counter reply/,
    );
  });

  it('propagates a store error so the caller can fail closed', async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Redis;
    await expect(recordAuthFailure(redis, '10.0.0.1')).rejects.toThrow('ECONNREFUSED');
  });
});

describe('createBullBoardPlugin', () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    queueInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('rejects a request without credentials with 401 problem+json', async () => {
    const redis = makeRedis();
    app = await buildApp(redis);

    const res = await app.inject({ method: 'GET', url: BASE_PATH });

    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['www-authenticate']).toBe('Basic realm="Bull Board"');
    expect(res.json()).toMatchObject({
      status: 401,
      code: 'unauthorized',
      instance: BASE_PATH,
      type: expect.stringContaining('unauthorized'),
    });
    expect(res.json()).toHaveProperty('timestamp');
    expect(res.json()).toHaveProperty('requestId');
  });

  it('rejects wrong credentials with 401 and counts the attempt', async () => {
    const redis = makeRedis();
    app = await buildApp(redis);

    const res = await app.inject({
      method: 'GET',
      url: BASE_PATH,
      headers: { authorization: authHeader('admin', 'wrong') },
    });

    expect(res.statusCode).toBe(401);
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it('switches to 429 problem+json once the failed-attempt budget is spent', async () => {
    const redis = makeRedis();
    app = await buildApp(redis);

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'GET',
        url: BASE_PATH,
        headers: { authorization: authHeader('admin', 'wrong') },
      });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);

    const throttled = await app.inject({
      method: 'GET',
      url: BASE_PATH,
      headers: { authorization: authHeader('admin', 'wrong') },
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers['content-type']).toContain('application/problem+json');
    expect(throttled.headers['retry-after']).toBe('60');
    expect(throttled.headers['www-authenticate']).toBeUndefined();
    expect(throttled.json()).toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('never charges authenticated traffic against the budget', async () => {
    const redis = makeRedis();
    app = await buildApp(redis);

    for (let i = 0; i < 40; i++) {
      const res = await app.inject({
        method: 'GET',
        url: BASE_PATH,
        headers: { authorization: authHeader('admin', 'secret') },
      });
      expect(res.statusCode).toBe(200);
    }

    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('serves static assets to an authenticated operator without throttling', async () => {
    const redis = makeRedis();
    app = await buildApp(redis);

    for (let i = 0; i < 30; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/static/app.js`,
        headers: { authorization: authHeader('admin', 'secret') },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('accepts a password containing colons', async () => {
    const redis = makeRedis();
    app = await buildApp(redis, { password: 'secret:with:colons' });

    const res = await app.inject({
      method: 'GET',
      url: BASE_PATH,
      headers: { authorization: authHeader('admin', 'secret:with:colons') },
    });

    expect(res.statusCode).toBe(200);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('rejects a credential whose length differs from the secret', async () => {
    const redis = makeRedis();
    app = await buildApp(redis);

    const res = await app.inject({
      method: 'GET',
      url: BASE_PATH,
      headers: { authorization: authHeader('admin', 'a-much-longer-wrong-password') },
    });

    expect(res.statusCode).toBe(401);
  });

  it('fails closed with 503 problem+json when the throttle store is unavailable', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const redis = makeRedis({
      eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Partial<Redis>);
    app = await buildApp(redis);

    const res = await app.inject({
      method: 'GET',
      url: BASE_PATH,
      headers: { authorization: authHeader('admin', 'wrong') },
    });

    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['retry-after']).toBe('5');
    expect(res.json()).toMatchObject({ status: 503, code: 'service_unavailable' });
  });

  it('still serves a valid operator while the throttle store is down', async () => {
    const redis = makeRedis({
      eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Partial<Redis>);
    app = await buildApp(redis);

    const res = await app.inject({
      method: 'GET',
      url: BASE_PATH,
      headers: { authorization: authHeader('admin', 'secret') },
    });

    expect(res.statusCode).toBe(200);
  });

  it('renders an error raised inside the Bull Board scope as problem+json', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const redis = makeRedis();
    app = await buildApp(redis);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE_PATH}/api/queues`,
      headers: { authorization: authHeader('admin', 'secret') },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      status: 500,
      title: 'Internal Server Error',
      code: 'internal_server_error',
    });
  });

  it('overrides the library default error handler installed by createBullBoard', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const redis = makeRedis();
    app = await buildApp(redis);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE_PATH}/api/queues`,
      headers: { authorization: authHeader('admin', 'secret') },
    });

    // The library default would emit `{ error: 'Internal server error' }` with no RFC 9457 members.
    expect(res.json()).not.toHaveProperty('error');
    expect(res.json()).toHaveProperty('type');
  });

  it('closes every queue connection on shutdown', async () => {
    const redis = makeRedis();
    const local = await buildApp(redis);
    expect(queueInstances.length).toBeGreaterThan(0);

    await local.close();

    expect(queueInstances.every((queue) => queue.close.mock.calls.length === 1)).toBe(true);
  });

  it('force-disconnects a queue when graceful close fails', async () => {
    const redis = makeRedis();
    const local = await buildApp(redis);
    const [firstQueue, ...remainingQueues] = queueInstances;
    if (!firstQueue) throw new Error('no BullMQ queues created');
    firstQueue.close.mockRejectedValueOnce(new Error('close failed'));

    await local.close();

    expect(firstQueue.disconnect).toHaveBeenCalledOnce();
    expect(remainingQueues.every((queue) => queue.disconnect.mock.calls.length === 0)).toBe(true);
  });
});
