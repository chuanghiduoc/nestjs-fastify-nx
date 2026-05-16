import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
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

    it('atomically writes a users.registered outbox row via the DB trigger', async () => {
      const signup = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'outbox@example.com', password: 'password123', name: 'Outbox' })
        .expect(200);

      const userId = signup.body.user.id as string;

      const prisma = ctx.app.get(PrismaService).db;
      const rows = await prisma.outboxEvent.findMany({
        where: { eventType: 'users.registered', aggregateId: userId },
      });
      expect(rows).toHaveLength(1);
      const payload = rows[0].payload as {
        eventId: string;
        occurredAt: string;
        payload: { email: string };
      };
      expect(payload.payload.email).toBe('outbox@example.com');
      expect(payload.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(rows[0].processedAt).toBeNull();
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

    it('emits a users.logged_in outbox row from the sessions trigger on signup', async () => {
      const signup = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'login-trigger@example.com', password: 'password123', name: 'Login' })
        .expect(200);

      const userId = signup.body.user.id as string;
      const prisma = ctx.app.get(PrismaService).db;
      const rows = await prisma.outboxEvent.findMany({
        where: { eventType: 'users.logged_in', aggregateId: userId },
      });
      expect(rows).toHaveLength(1);
      const payload = rows[0].payload as {
        eventId: string;
        payload: { sessionId: string; ip?: string; userAgent?: string };
      };
      expect(payload.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(payload.payload.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
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

    // AUTH_RATE_LIMIT_MAX is set to 3 in test-app.ts so the 4th request hits 429.
    it('returns 429 with application/problem+json after exceeding rate limit', async () => {
      const payload = { email: 'ratelimit@example.com', password: 'wrongpassword' };
      for (let i = 0; i < 3; i++) {
        await request(ctx.app.getHttpServer()).post('/api/auth/sign-in/email').send(payload);
      }
      const res = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send(payload)
        .expect(429);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.status).toBe(429);
      expect(res.body.title).toBe('Too Many Requests');
      expect(res.body.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('Body size limits', () => {
    it('returns 413 with application/problem+json when JSON body exceeds bodyLimit', async () => {
      // HTTP_BODY_LIMIT_BYTES is set to 64 KB in test-app.ts; send 128 KB payload.
      const oversizedBody = JSON.stringify({ data: 'x'.repeat(130 * 1024) });
      const res = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .set('Content-Type', 'application/json')
        .send(oversizedBody)
        .expect(413);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.status).toBe(413);
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

    it('emits a users.logged_out outbox row from the sessions trigger on sign-out', async () => {
      const signUp = await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: 'logout-trigger@example.com', password: 'password123', name: 'Logout' })
        .expect(200);

      const userId = signUp.body.user.id as string;
      const cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);

      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Cookie', cookie)
        .expect(200);

      const prisma = ctx.app.get(PrismaService).db;
      const rows = await prisma.outboxEvent.findMany({
        where: { eventType: 'users.logged_out', aggregateId: userId },
      });
      expect(rows).toHaveLength(1);
      const payload = rows[0].payload as {
        eventId: string;
        payload: { tokenId: string; sessionExpiresAt?: string };
      };
      expect(payload.payload.tokenId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      // expiresAt is set by Better Auth on session creation, so the trigger
      // always sees it on DELETE — exact value depends on `expiresIn`, just
      // assert it is present and shaped like an ISO instant.
      expect(payload.payload.sessionExpiresAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });
  });
});
