import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestAppContext } from './test-app';

// ENABLE_METRICS is set to 'true' in vite.e2e.config.ts so AppModule's
// module-level conditional import picks up MetricsModule. The /metrics route
// is registered OUTSIDE the api/v1 prefix (see main.ts setGlobalPrefix exclude).
describe('Health & Metrics E2E', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 180_000);

  afterAll(async () => {
    await ctx.app.close();
    await ctx.containers.teardown();
  });

  describe('GET /api/v1/health/live', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/live').expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.status).toBe('ok');
    });

    it('timestamp is a valid ISO-8601 string', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/live').expect(200);

      const { timestamp } = res.body.data as { timestamp: string };
      expect(typeof timestamp).toBe('string');
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('response envelope contains meta with requestId and timestamp', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/live').expect(200);

      expect(res.body.meta).toBeDefined();
      expect(typeof res.body.meta.requestId).toBe('string');
      expect(typeof res.body.meta.timestamp).toBe('string');
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('returns 200 when database is up', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/ready').expect(200);

      expect(res.body.data.status).toBe('ok');
    });

    it('reports database, redis_cache, and redis_queue indicators as up', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/ready').expect(200);

      // Indicator names match HealthController.readiness() — `database`,
      // `redis_cache`, `redis_queue` (registered separately so we can scope
      // alerts per Redis instance).
      expect(res.body.data.info.database.status).toBe('up');
      expect(res.body.data.info.redis_cache.status).toBe('up');
      expect(res.body.data.info.redis_queue.status).toBe('up');
    });

    it('details mirrors info for each indicator', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/ready').expect(200);

      expect(res.body.data.details.database.status).toBe('up');
      expect(res.body.data.details.redis_cache.status).toBe('up');
      expect(res.body.data.details.redis_queue.status).toBe('up');
    });
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with overall status ok', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(res.body.data.status).toBe('ok');
    });

    it('reports database, memory_heap, redis_cache, and redis_queue indicators as up', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(res.body.data.info.database.status).toBe('up');
      expect(res.body.data.info.memory_heap.status).toBe('up');
      expect(res.body.data.info.redis_cache.status).toBe('up');
      expect(res.body.data.info.redis_queue.status).toBe('up');
    });

    it('response body conforms to terminus HealthCheckResult shape', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

      const { data } = res.body as {
        data: { status: string; info: Record<string, unknown>; details: Record<string, unknown> };
      };
      expect(['ok', 'error', 'shutting_down']).toContain(data.status);
      expect(data.info).toBeDefined();
      expect(data.details).toBeDefined();
    });
  });

  // /metrics is excluded from setGlobalPrefix('api/v1', { exclude: ['metrics'] }),
  // so it resolves at the bare path. Prom-client returns text/plain, not JSON,
  // and MetricsController writes via @Res() so ResponseInterceptor is bypassed.
  describe('GET /metrics', () => {
    it('returns 200 with Prometheus text format', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/metrics').expect(200);

      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('# HELP');
      expect(res.text).toContain('# TYPE');
    });

    it('exposes default Node.js process metrics', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/metrics').expect(200);

      expect(res.text).toContain('process_cpu_seconds_total');
    });

    it('response is not wrapped in the data/meta envelope', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/metrics').expect(200);

      expect(res.text.length).toBeGreaterThan(0);
      expect(res.body).not.toHaveProperty('data');
    });
  });

  describe('POST /api/v1/upload', () => {
    it('returns 401 without a session cookie', async () => {
      // BetterAuthGuard is the global APP_GUARD; unauthenticated calls are 401.
      await request(ctx.app.getHttpServer()).post('/api/v1/upload').expect(401);
    });
  });
});
