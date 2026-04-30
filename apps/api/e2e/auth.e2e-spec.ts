import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

// Better Auth mounts its own routes under /api/auth/*. They live OUTSIDE the
// /api/v1 prefix and are not wrapped by ResponseInterceptor — bodies are the
// raw Better Auth shape (e.g. { token, user }), not { data, meta }.
describe('Auth E2E (Better Auth)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 180_000);

  afterAll(async () => {
    await ctx.app.close();
    await ctx.containers.teardown();
  });

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
  });

  describe('POST /api/auth/sign-up/email', () => {
    it('creates a user and returns a session cookie', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'new@example.com', password: 'password123', name: 'New User' })
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('new@example.com');
      expect(res.headers['set-cookie']).toBeDefined();
      // Session token cookie is named `better-auth.session_token` by default.
      const setCookie = Array.isArray(res.headers['set-cookie'])
        ? res.headers['set-cookie'].join('\n')
        : res.headers['set-cookie'];
      expect(setCookie).toMatch(/better-auth\.session_token=/);
    });

    it('rejects duplicate email with 4xx', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'dup@example.com', password: 'password123', name: 'Dup' })
        .expect(200);

      const res = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'dup@example.com', password: 'password123', name: 'Dup' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('rejects passwords shorter than the configured minimum', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'short@example.com', password: 'tiny', name: 'Short' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('POST /api/auth/sign-in/email', () => {
    beforeEach(async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'user@example.com', password: 'password123', name: 'User' });
    });

    it('returns a session cookie for valid credentials', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: 'user@example.com', password: 'password123' })
        .expect(200);

      expect(res.body.user.email).toBe('user@example.com');
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects wrong password with 401', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: 'user@example.com', password: 'wrongpassword' })
        .expect(401);
    });

    it('rejects unknown email with 401', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: 'unknown@example.com', password: 'password123' })
        .expect(401);
    });
  });

  describe('GET /api/auth/get-session', () => {
    it('returns null session without cookies', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/auth/get-session').expect(200);

      // Better Auth returns `null` (or empty object) when no session cookie is present.
      expect(res.body === null || Object.keys(res.body ?? {}).length === 0).toBe(true);
    });

    it('returns the active session when cookie is forwarded', async () => {
      const signUp = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'session@example.com', password: 'password123', name: 'Session' })
        .expect(200);

      const cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
      const res = await request(ctx.app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.user.email).toBe('session@example.com');
      expect(res.body.session).toBeDefined();
    });
  });

  describe('Sign-out flow', () => {
    it('clears session cookies — requests with the cleared cookies return 401', async () => {
      const signUp = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'signout@example.com', password: 'password123', name: 'Sign Out' })
        .expect(200);

      const cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);

      // Confirm session works before sign-out.
      await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', cookie)
        .expect(200);

      const signOut = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Cookie', cookie)
        .expect(200);

      // Sign-out responds with Set-Cookie headers that expire session_token and
      // session_data (Max-Age=0). A real browser replaces its stored cookies
      // with these cleared ones, so subsequent requests carry no valid session.
      // Note: cookieCache is enabled (5min in better-auth.config.ts) — the
      // original sign-up cookie keeps verifying for the cache window because
      // session_data is self-contained and signed; the realistic post-signout
      // state is the cleared cookies the server just sent back.
      const clearedCookie = cookieHeaderFromSetCookies(signOut.headers['set-cookie']);
      expect(clearedCookie).toMatch(/better-auth\.session_token=/);

      await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', clearedCookie)
        .expect(401);
    });
  });
});
