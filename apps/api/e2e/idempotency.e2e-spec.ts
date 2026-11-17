import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import {
  createTestApp,
  cookieHeaderFromSetCookies,
  resetRateLimitBudget,
  type TestAppContext,
} from './test-app';

// Exercises the Fastify idempotency plugin end-to-end against real Redis (Testcontainers) and a
// real authenticated endpoint. presign returns a freshly-random `key` each call, so an identical
// body proves the second request replayed the first rather than re-running the handler.
describe('Idempotency E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    await resetRateLimitBudget();
    const email = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password1234', name: 'Idem' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  function freshKey(): string {
    return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  it('replays the first response for a repeated Idempotency-Key', async () => {
    const key = freshKey();

    const first = await request(ctx.app.getHttpServer())
      .post('/api/v1/upload/presign')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ contentType: 'image/png' })
      .expect(201);

    const second = await request(ctx.app.getHttpServer())
      .post('/api/v1/upload/presign')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ contentType: 'image/png' })
      .expect(201);

    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
    // Same key + same body → replay returns the byte-identical first response (random `key` and
    // `expiresAt` included), which would otherwise differ per call.
    expect(second.body).toEqual(first.body);
  });

  it('returns 422 idempotency_key_mismatch when the key is reused with a different body', async () => {
    const key = freshKey();

    await request(ctx.app.getHttpServer())
      .post('/api/v1/upload/presign')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ contentType: 'image/png' })
      .expect(201);

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/upload/presign')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ contentType: 'image/jpeg' })
      .expect(422);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('idempotency_key_mismatch');
  });

  it('does not engage without an Idempotency-Key header', async () => {
    const first = await request(ctx.app.getHttpServer())
      .post('/api/v1/upload/presign')
      .set('Cookie', cookie)
      .send({ contentType: 'image/png' })
      .expect(201);

    const second = await request(ctx.app.getHttpServer())
      .post('/api/v1/upload/presign')
      .set('Cookie', cookie)
      .send({ contentType: 'image/png' })
      .expect(201);

    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(second.body.key).not.toBe(first.body.key);
  });

  it.each(['/api/v1/api-keys', '/api/v1/api-keys/'])(
    'never replays the one-shot API key returned by POST %s',
    async (url) => {
      const key = freshKey();
      const body = { name: 'CI bot', scopes: [PERMISSIONS.FEATURE_FLAG_READ] };

      const first = await request(ctx.app.getHttpServer())
        .post(url)
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      const second = await request(ctx.app.getHttpServer())
        .post(url)
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send(body)
        .expect(409);

      expect(first.body.key.startsWith('sk_')).toBe(true);
      expect(second.headers['idempotent-replayed']).toBeUndefined();
      expect(JSON.stringify(second.body)).not.toContain(first.body.key);
    },
  );
});
