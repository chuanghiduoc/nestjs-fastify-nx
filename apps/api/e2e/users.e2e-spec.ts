import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

describe('Users E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 180_000);

  afterAll(async () => {
    await ctx.app.close();
    await ctx.containers.teardown();
  });

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: 'me@example.com', password: 'password123', name: 'Me' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  describe('GET /api/v1/users/me', () => {
    it('returns the user profile for an authenticated session', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.email).toBe('me@example.com');
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.role).toBe('USER');
    });

    it('returns 401 without a session cookie', async () => {
      await request(ctx.app.getHttpServer()).get('/api/v1/users/me').expect(401);
    });

    it('returns 401 with a malformed cookie', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', 'better-auth.session_token=not-a-real-token')
        .expect(401);
    });
  });

  describe('GET /api/v1/admin/users', () => {
    it('returns 403 for a non-admin session', async () => {
      // Default seeded role is USER — RolesGuard rejects with 403.
      await request(ctx.app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Cookie', cookie)
        .expect(403);
    });
  });
});
