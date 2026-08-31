import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

describe('API keys E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    const email = `apikey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password123', name: 'Key Owner' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);
  });

  async function issueKey(scopes: string[] = [PERMISSIONS.FEATURE_FLAG_READ]): Promise<string> {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Cookie', cookie)
      .send({ name: 'CI bot', scopes })
      .expect(201);
    return res.body.key;
  }

  it('returns the raw key exactly once, and never again from the listing', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Cookie', cookie)
      .send({ name: 'CI bot', scopes: [PERMISSIONS.FEATURE_FLAG_READ] })
      .expect(201);

    expect(typeof created.body.key).toBe('string');
    expect(created.body.key.startsWith('sk_')).toBe(true);
    expect(created.body.prefix).toBeTruthy();

    const listed = await request(ctx.app.getHttpServer())
      .get('/api/v1/api-keys')
      .set('Cookie', cookie)
      .expect(200);

    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).not.toHaveProperty('key');
    expect(listed.body.data[0]).not.toHaveProperty('keyHash');
    expect(JSON.stringify(listed.body)).not.toContain(created.body.key);
  });

  it('stores only a digest of the key', async () => {
    const raw = await issueKey();

    const rows = await ctx.app.get(PrismaService).db.apiKey.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].keyHash).not.toBe(raw);
    expect(raw).not.toContain(rows[0].keyHash);
  });

  // The escalation guard: a member cannot mint a key stronger than themselves.
  it('rejects a scope the caller does not hold with 422', async () => {
    const prisma = ctx.app.get(PrismaService).db;
    const membership = await prisma.member.findFirstOrThrow();
    await prisma.organizationRole.create({
      data: {
        organizationId: membership.organizationId,
        role: 'limited',
        permission: JSON.stringify({ api_key: ['create', 'read'], feature_flag: ['read'] }),
      },
    });
    await prisma.member.updateMany({ data: { role: 'limited' } });

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Cookie', cookie)
      .send({ name: 'escalating', scopes: [PERMISSIONS.ORGANIZATION_DELETE] })
      .expect(422);

    expect(res.body.code).toBe('api_key_scope_exceeds_grant');
  });

  it('authenticates a machine caller on a route that opted in', async () => {
    const raw = await issueKey();

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/feature-flags')
      .set('Authorization', `Bearer ${raw}`)
      .expect(200);

    expect(res.body.object).toBe('list');
  });

  it('accepts the key through the X-Api-Key header too', async () => {
    const raw = await issueKey();

    await request(ctx.app.getHttpServer())
      .get('/api/v1/feature-flags')
      .set('X-Api-Key', raw)
      .expect(200);
  });

  // A key has no user behind it, so a route that reads @CurrentUser() must refuse it outright
  // rather than reach a handler that assumes a session.
  it('refuses a key on a route that did not opt into machine access', async () => {
    const raw = await issueKey([PERMISSIONS.MEMBER_READ]);

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${raw}`)
      .expect(401);

    expect(res.body.code).toBe('api_key_invalid_credential');
  });

  it('refuses an unknown key', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/feature-flags')
      .set('Authorization', 'Bearer sk_thiskeydoesnotexistatall000000000000000000')
      .expect(401);

    expect(res.body.code).toBe('api_key_invalid_credential');
  });

  it('stops accepting a key once it is revoked', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Cookie', cookie)
      .send({ name: 'CI bot', scopes: [PERMISSIONS.FEATURE_FLAG_READ] })
      .expect(201);

    await request(ctx.app.getHttpServer())
      .get('/api/v1/feature-flags')
      .set('Authorization', `Bearer ${created.body.key}`)
      .expect(200);

    await request(ctx.app.getHttpServer())
      .delete(`/api/v1/api-keys/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);

    await request(ctx.app.getHttpServer())
      .get('/api/v1/feature-flags')
      .set('Authorization', `Bearer ${created.body.key}`)
      .expect(401);
  });

  it('revoking twice is a no-op', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Cookie', cookie)
      .send({ name: 'CI bot', scopes: [PERMISSIONS.FEATURE_FLAG_READ] })
      .expect(201);

    await request(ctx.app.getHttpServer())
      .delete(`/api/v1/api-keys/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);
    await request(ctx.app.getHttpServer())
      .delete(`/api/v1/api-keys/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);
  });

  it('refuses a key whose scopes do not cover the route permission', async () => {
    const raw = await issueKey([PERMISSIONS.MEMBER_READ]);

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/feature-flags')
      .set('Authorization', `Bearer ${raw}`)
      .expect(403);

    expect(res.body.code).toBe('forbidden');
  });

  it('requires a session cookie to manage keys', async () => {
    await request(ctx.app.getHttpServer()).get('/api/v1/api-keys').expect(401);
  });

  it('rejects an expiry in the past with 422', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Cookie', cookie)
      .send({
        name: 'CI bot',
        scopes: [PERMISSIONS.FEATURE_FLAG_READ],
        expiresAt: '2020-01-01T00:00:00.000Z',
      })
      .expect(422);

    expect(res.body.status).toBe(422);
  });
});
