import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

describe('Users E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: 'me@example.com', password: 'password123', name: 'Me' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  describe('GET /api/v1/users/me', () => {
    it('returns the user profile directly (no envelope)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.email).toBe('me@example.com');
      expect(res.body.id).toBeDefined();
      expect(res.body.role).toBe('USER');
      // No `data`/`meta` envelope — Stripe-style direct response.
      expect(res.body).not.toHaveProperty('data');
      expect(res.body).not.toHaveProperty('meta');
    });

    it('mirrors the request id on the X-Request-Id response header', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', cookie)
        .expect(200);

      expect(typeof res.headers['x-request-id']).toBe('string');
      expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
    });

    it('returns 401 with a Problem Details body when the cookie is missing', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/users/me').expect(401);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.status).toBe(401);
      expect(res.body.code).toBe('unauthorized');
      expect(res.body.title).toBe('Unauthorized');
      expect(res.body.instance).toBe('/api/v1/users/me');
      expect(res.body.requestId).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });

    it('returns 401 with a malformed cookie', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', 'better-auth.session_token=not-a-real-token')
        .expect(401);
    });
  });

  describe('GET /api/v1/admin/users', () => {
    it('returns 403 with Problem Details for a non-admin session', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Cookie', cookie)
        .expect(403);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    });
  });

  describe('Problem Details — unknown route', () => {
    it('returns 404 with the canonical RFC 9457 envelope', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/this-route-does-not-exist')
        .expect(404);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(res.body.type).toMatch(/\/errors\/not-found$/);
      expect(res.body.instance).toBe('/api/v1/this-route-does-not-exist');
      expect(res.body.requestId).toBeDefined();
      expect(typeof res.body.timestamp).toBe('string');
    });
  });
});
