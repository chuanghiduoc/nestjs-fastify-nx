import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

describe('Users E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;
  let userEmail: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    // Unique email per test so the strict rate-limit bucket (keyed by ip+email)
    // never collides across the 6 sign-ups in this suite.
    userEmail = `me-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: userEmail, password: 'password123', name: 'Me' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  describe('GET /api/v1/users/me', () => {
    it('returns the user profile directly (no envelope)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.email).toBe(userEmail);
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
    // The listing is organization-scoped now, so an ordinary member is allowed to see their own
    // organization's members. What is refused is a role that does not carry member:read.
    it('returns 403 with Problem Details when the role lacks member:read', async () => {
      const prisma = ctx.app.get(PrismaService).db;
      const membership = await prisma.member.findFirstOrThrow();
      await prisma.organizationRole.create({
        data: {
          organizationId: membership.organizationId,
          role: 'no-access',
          permission: JSON.stringify({ file: ['read'] }),
        },
      });
      await prisma.member.updateMany({ data: { role: 'no-access' } });

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Cookie', cookie)
        .expect(403);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    });

    it('lists only members of the caller organization', async () => {
      const prisma = ctx.app.get(PrismaService).db;
      const outsider = await prisma.user.create({
        data: { email: 'outsider@example.com', name: 'Outsider', updatedAt: new Date() },
      });
      const otherOrg = await prisma.organization.create({
        data: { name: 'Other', slug: `other-${Date.now()}` },
      });
      await prisma.member.create({
        data: { organizationId: otherOrg.id, userId: outsider.id, role: 'owner' },
      });

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/admin/users?limit=50')
        .set('Cookie', cookie)
        .expect(200);

      const emails = res.body.data.map((u: { email: string }) => u.email);
      expect(emails).toContain(userEmail);
      expect(emails).not.toContain('outsider@example.com');
    });

    it('returns 200 + Stripe-style cursor envelope for a member with member:read', async () => {
      const adminCookie = cookie;

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/admin/users?limit=5')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.object).toBe('list');
      expect(res.body.url).toBe('/api/v1/admin/users');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(typeof res.body.hasMore).toBe('boolean');
      // Cursor envelope MUST carry an opaque continuation token (or null when empty)
      // so clients can fetch the next page by passing it back as `startingAfter`.
      expect(res.body).toHaveProperty('lastCursor');
      expect(typeof res.body.lastCursor === 'string' || res.body.lastCursor === null).toBe(true);
      if (typeof res.body.lastCursor === 'string') {
        // Cursor is base64url(`${createdAt.toISOString()}:${id}`) — sanity-check the alphabet.
        expect(res.body.lastCursor).toMatch(/^[A-Za-z0-9_-]+$/);
      }
      // Cursor envelope must NOT include offset fields
      expect(res.body).not.toHaveProperty('page');
      expect(res.body).not.toHaveProperty('pageSize');
      expect(res.body).not.toHaveProperty('totalCount');
    });

    it('rejects limit > 100 with 422 validation_failed', async () => {
      const adminCookie = cookie;

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/admin/users?limit=9999')
        .set('Cookie', adminCookie)
        .expect(422);

      expect(res.body.code).toBe('validation_failed');
    });
  });

  describe('Cookie integrity', () => {
    it('rejects a cookie whose signature is tampered (not just malformed)', async () => {
      // /g flag — Better Auth sets multiple cookies (session_token + session_data);
      // flipping only the first match may leave the auth-validating cookie intact.
      const tampered = cookie.replace(/([A-Za-z0-9_-]{16,})/g, (m) => m.slice(0, -1) + 'X');
      await request(ctx.app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Cookie', tampered)
        .expect(401);
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
