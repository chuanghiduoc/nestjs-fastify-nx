import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

// Contract test for the profile response the generated api-client (and therefore the SPA)
// consumes. It does NOT import `@nestjs-fastify-nx/api-client`: that would add an `api -> api-client`
// project edge on top of the existing `api-client -> api` codegen edge, creating a cycle that breaks
// `nx typecheck`/`nx lint` for the whole api project. The two halves of the contract are covered
// separately instead: CI's "Verify generated API client is up to date" step regenerates the client
// from the live OpenAPI spec and fails on drift (spec <-> client), while this test asserts the
// running API's response matches the published `UserProfileResponseDto` shape byte-for-byte
// (API <-> spec). Together they close the same loop without the import cycle.
describe('api-client contract — UserProfileResponseDto', () => {
  let ctx: TestAppContext;
  let cookie: string;
  let email: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    email = `contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password123', name: 'Contract Test' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  it('returns exactly the contracted profile fields with correct types and enum domains', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', cookie)
      .expect(200);

    // Every documented field present with the contracted type.
    expect(res.body).toMatchObject({
      id: expect.any(String),
      email,
      name: 'Contract Test',
      role: 'USER',
      status: 'ACTIVE',
    });
    expect(typeof res.body.createdAt).toBe('string');
    expect(typeof res.body.updatedAt).toBe('string');
    // Timestamps are ISO-8601 strings, not epoch numbers — the SPA parses them as dates.
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
    expect(new Date(res.body.updatedAt).toISOString()).toBe(res.body.updatedAt);

    // Enum domains match the generated union — a new value would break the typed client.
    expect(['USER', 'ADMIN']).toContain(res.body.role);
    expect(['ACTIVE', 'INACTIVE', 'BANNED']).toContain(res.body.status);

    // Stripe-style: the resource is returned directly, no envelope.
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('meta');

    // No field outside the DTO leaks — especially auth/sensitive columns. The contract is a
    // fixed allow-list, so any extra key is a regression the typed client would silently drop.
    expect(Object.keys(res.body).sort()).toEqual(
      ['createdAt', 'email', 'id', 'name', 'role', 'status', 'updatedAt'].sort(),
    );
  });

  it('rejects the profile read with an RFC 9457 problem+json 401 when unauthenticated', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/users/me').expect(401);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
