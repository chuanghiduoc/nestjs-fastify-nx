import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { createBullBoardPlugin } from '../src/common/bull-board/create-bull-board-plugin';
import { applyFastifyProblemDetailsHook } from '../src/common/filters/fastify-error-handler';

// Bull Board is a raw Fastify plugin mounted outside the Nest pipeline, so this suite boots the
// same wiring main.ts does with the real @bull-board packages and a real Redis. The unit spec
// substitutes the adapter, which is where a 429-rendered-as-500 defect can hide: the library
// installs its own error handler inside the scope it owns.
const BASE_PATH = '/api/admin/queues';
const USER = 'bull-admin';
const PASSWORD = 'bull-secret';

function authHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('Bull Board E2E', () => {
  let app: FastifyInstance;
  let redis: Redis;

  beforeAll(async () => {
    const host = process.env['E2E_REDIS_HOST'];
    const port = Number(process.env['E2E_REDIS_PORT']);
    if (!host || !Number.isFinite(port)) {
      throw new Error('E2E Redis endpoint is not configured');
    }

    redis = new Redis({ host, port, db: 4, maxRetriesPerRequest: 1 });

    app = Fastify({ logger: false });
    applyFastifyProblemDetailsHook(app);
    await app.register(
      createBullBoardPlugin({
        user: USER,
        password: PASSWORD,
        basePath: BASE_PATH,
        redisHost: host,
        redisPort: port,
        queuePrefix: 'bull-e2e',
        redis,
      }),
    );
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await redis?.quit().catch(() => redis?.disconnect());
  });

  beforeEach(async () => {
    // The failed-attempt budget is keyed by IP and shared across tests in this file.
    const keys = await redis.keys('bull-board:auth-fail:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  describe('authentication', () => {
    it('rejects a request without credentials with RFC 9457 problem+json', async () => {
      const res = await app.inject({ method: 'GET', url: BASE_PATH });

      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['www-authenticate']).toBe('Basic realm="Bull Board"');
      expect(res.json()).toMatchObject({
        status: 401,
        title: 'Unauthorized',
        code: 'unauthorized',
        instance: BASE_PATH,
      });
      expect(res.json()).toHaveProperty('type');
      expect(res.json()).toHaveProperty('timestamp');
      expect(res.headers['x-request-id']).toBeTruthy();
    });

    it('serves the dashboard to a valid operator', async () => {
      const res = await app.inject({
        method: 'GET',
        url: BASE_PATH,
        headers: { authorization: authHeader(USER, PASSWORD) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('<html');
    });

    it('serves the dashboard static bundle to a valid operator', async () => {
      const entry = await app.inject({
        method: 'GET',
        url: BASE_PATH,
        headers: { authorization: authHeader(USER, PASSWORD) },
      });
      const assetPath = /src="([^"]*static\/[^"]+\.js)"/.exec(entry.body)?.[1];
      expect(assetPath).toBeTruthy();

      const url = assetPath?.startsWith('http')
        ? new URL(assetPath).pathname
        : `${BASE_PATH}/${String(assetPath).replace(/^\.?\//, '')}`;
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: authHeader(USER, PASSWORD) },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('failed-attempt throttling', () => {
    it('returns 429 problem+json — not 500 — once the budget is spent', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({
          method: 'GET',
          url: BASE_PATH,
          headers: { authorization: authHeader(USER, 'wrong-password') },
        });
        statuses.push(res.statusCode);
      }

      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(statuses.slice(10)).toEqual([429, 429]);

      const throttled = await app.inject({
        method: 'GET',
        url: BASE_PATH,
        headers: { authorization: authHeader(USER, 'wrong-password') },
      });
      expect(throttled.statusCode).toBe(429);
      expect(throttled.headers['content-type']).toContain('application/problem+json');
      expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
      expect(throttled.json()).toMatchObject({
        status: 429,
        title: 'Too Many Requests',
        code: 'rate_limited',
        instance: BASE_PATH,
      });
    });

    it('never throttles an authenticated operator, however chatty the dashboard is', async () => {
      // Well above the failed-attempt budget: a single page load plus a minute of queue polling.
      for (let i = 0; i < 60; i++) {
        const res = await app.inject({
          method: 'GET',
          url: BASE_PATH,
          headers: { authorization: authHeader(USER, PASSWORD) },
        });
        expect(res.statusCode).toBe(200);
      }

      const counter = await redis.keys('bull-board:auth-fail:*');
      expect(counter).toEqual([]);
    });

    it('lets a valid operator in even after that IP burned the budget', async () => {
      for (let i = 0; i < 12; i++) {
        await app.inject({
          method: 'GET',
          url: BASE_PATH,
          headers: { authorization: authHeader(USER, 'wrong-password') },
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: BASE_PATH,
        headers: { authorization: authHeader(USER, PASSWORD) },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('queue API', () => {
    it('returns the queue list as JSON to a valid operator', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE_PATH}/api/queues`,
        headers: { authorization: authHeader(USER, PASSWORD) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('queues');
    });

    it('requires credentials for the queue API too', async () => {
      const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/api/queues` });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ status: 401, code: 'unauthorized' });
    });
  });
});
