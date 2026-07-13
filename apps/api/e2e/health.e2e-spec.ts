import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestAppContext } from './test-app';

// ENABLE_METRICS is set to 'true' in vite.e2e.config.ts so AppModule's
// module-level conditional import picks up MetricsModule. The /metrics route
// is registered OUTSIDE the api/v1 prefix (see main.ts setGlobalPrefix exclude).
describe('Health & Metrics E2E', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
  });

  describe('GET /api/v1/health/live', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/live').expect(200);

      expect(res.body.status).toBe('ok');
    });

    it('timestamp is a valid ISO-8601 string', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/live').expect(200);

      const { timestamp } = res.body as { timestamp: string };
      expect(typeof timestamp).toBe('string');
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('exposes X-Request-Id header on every response', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/live').expect(200);

      expect(typeof res.headers['x-request-id']).toBe('string');
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('returns 200 when database is up', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/ready').expect(200);

      expect(res.body.status).toBe('ok');
    });

    it('reports database, redis_cache, and redis_queue indicators as up', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/ready').expect(200);

      // Indicator names match HealthController.readiness() — `database`,
      // `redis_cache`, `redis_queue` (registered separately so we can scope
      // alerts per Redis instance).
      expect(res.body.info.database.status).toBe('up');
      expect(res.body.info.redis_cache.status).toBe('up');
      expect(res.body.info.redis_queue.status).toBe('up');
    });

    it('details mirrors info for each indicator', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/ready').expect(200);

      expect(res.body.details.database.status).toBe('up');
      expect(res.body.details.redis_cache.status).toBe('up');
      expect(res.body.details.redis_queue.status).toBe('up');
    });
  });

  describe('GET /api/v1/health/dependencies', () => {
    it('returns 200 with deep dependencies healthy (bullmq up; pgbouncer/replica no-op when unset)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/health/dependencies')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.info.bullmq.status).toBe('up');
    });

    it('does NOT report the deep indicators on the readiness probe', async () => {
      // Readiness must stay lean so a shared-dependency blip can't flip every replica to NotReady
      // at once. bullmq/pgbouncer/replication_lag live on /dependencies only.
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/ready').expect(200);

      expect(res.body.info.bullmq).toBeUndefined();
      expect(res.body.info.pgbouncer).toBeUndefined();
      expect(res.body.info.replication_lag).toBeUndefined();
    });
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with overall status ok', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(res.body.status).toBe('ok');
    });

    it('reports database, memory_heap, redis_cache, and redis_queue indicators as up', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(res.body.info.database.status).toBe('up');
      expect(res.body.info.memory_heap.status).toBe('up');
      expect(res.body.info.redis_cache.status).toBe('up');
      expect(res.body.info.redis_queue.status).toBe('up');
    });

    it('response body conforms to terminus HealthCheckResult shape', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

      const body = res.body as {
        status: string;
        info: Record<string, unknown>;
        details: Record<string, unknown>;
      };
      expect(['ok', 'error', 'shutting_down']).toContain(body.status);
      expect(body.info).toBeDefined();
      expect(body.details).toBeDefined();
    });
  });

  // /metrics is excluded from setGlobalPrefix('api/v1', { exclude: ['metrics'] }),
  // so it resolves at the bare path. Prom-client returns text/plain.
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
  });

  // Upload endpoint coverage lives in upload.e2e-spec.ts (presign success +
  // adversarial MIME / key-regex / 404 cases). Auth-guard smoke for /upload
  // is asserted there too.
});
