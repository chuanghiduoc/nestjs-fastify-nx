import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { generateId } from '@nestjs-fastify-nx/shared';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

const BASE_TIME = new Date('2026-08-01T00:00:00.000Z');

describe('Audit logs E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;
  let organizationId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    const email = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password123', name: 'Auditor' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);

    const prisma = ctx.app.get(PrismaService).db;
    const membership = await prisma.member.findFirstOrThrow();
    organizationId = membership.organizationId;
  });

  // `audit_logs` carries a row-level security policy, so a direct insert is rejected unless the
  // tenant setting the policy reads is bound on the same transaction — exactly what the runtime
  // does via PrismaService.withTenantContext.
  async function seedEntry(
    minutesFromBase: number,
    overrides: Partial<{ organizationId: string; action: string; resource: string }> = {},
  ): Promise<string> {
    const id = generateId();
    const targetOrganizationId = overrides.organizationId ?? organizationId;

    await ctx.app.get(PrismaService).db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_org_id', $1, true)`,
        targetOrganizationId,
      );
      await tx.auditLog.create({
        data: {
          id,
          organizationId: targetOrganizationId,
          userId: null,
          action: overrides.action ?? 'users.registered',
          resource: overrides.resource ?? 'user',
          metadata: { source: 'e2e' },
          createdAt: new Date(BASE_TIME.getTime() + minutesFromBase * 60_000),
        },
      });
    });

    return id;
  }

  it('returns 401 with Problem Details when the session cookie is missing', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/audit-logs').expect(401);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('returns 403 when the caller role does not carry audit_log:read', async () => {
    const prisma = ctx.app.get(PrismaService).db;
    await prisma.organizationRole.create({
      data: {
        organizationId,
        role: 'no-audit',
        permission: JSON.stringify({ file: ['read'] }),
      },
    });
    await prisma.member.updateMany({ data: { role: 'no-audit' } });

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Cookie', cookie)
      .expect(403);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('returns the Stripe-style cursor envelope without offset fields', async () => {
    await seedEntry(0);

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/audit-logs?limit=5')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.object).toBe('list');
    expect(res.body.url).toBe('/api/v1/audit-logs');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.hasMore).toBe('boolean');
    expect(res.body).toHaveProperty('lastCursor');
    expect(res.body).not.toHaveProperty('page');
    expect(res.body).not.toHaveProperty('pageSize');
    expect(res.body).not.toHaveProperty('totalCount');
  });

  it('never returns entries recorded for another organization', async () => {
    const prisma = ctx.app.get(PrismaService).db;
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other', slug: `other-${Date.now()}` },
    });
    const mine = await seedEntry(0);
    await seedEntry(1, { organizationId: otherOrg.id });

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/audit-logs?limit=50')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.data.map((entry: { id: string }) => entry.id)).toEqual([mine]);
  });

  it('filters by action and returns entries newest first', async () => {
    await seedEntry(0, { action: 'users.registered' });
    const newerLogin = await seedEntry(10, { action: 'users.logged_in' });
    const olderLogin = await seedEntry(5, { action: 'users.logged_in' });

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/audit-logs?limit=50&action=users.logged_in')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.data.map((entry: { id: string }) => entry.id)).toEqual([
      newerLogin,
      olderLogin,
    ]);
  });

  it('pages through entries using lastCursor', async () => {
    for (let index = 0; index < 3; index += 1) await seedEntry(index);

    const first = await request(ctx.app.getHttpServer())
      .get('/api/v1/audit-logs?limit=2')
      .set('Cookie', cookie)
      .expect(200);

    expect(first.body.hasMore).toBe(true);

    const second = await request(ctx.app.getHttpServer())
      .get(`/api/v1/audit-logs?limit=2&startingAfter=${first.body.lastCursor}`)
      .set('Cookie', cookie)
      .expect(200);

    const firstIds = first.body.data.map((entry: { id: string }) => entry.id);
    const secondIds = second.body.data.map((entry: { id: string }) => entry.id);
    expect(secondIds).toHaveLength(1);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
    expect(second.body.hasMore).toBe(false);
  });

  it('rejects a malformed cursor with 400 invalid_cursor', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/audit-logs?startingAfter=!!!not-a-cursor!!!')
      .set('Cookie', cookie)
      .expect(400);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('rejects a window whose lower bound is after its upper bound with 422', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(
        '/api/v1/audit-logs?occurredFrom=2026-08-31T00:00:00.000Z&occurredUntil=2026-08-01T00:00:00.000Z',
      )
      .set('Cookie', cookie)
      .expect(422);

    expect(res.body.code).toBe('validation_failed');
  });

  it('rejects limit > 100 with 422 validation_failed', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/audit-logs?limit=9999')
      .set('Cookie', cookie)
      .expect(422);

    expect(res.body.code).toBe('validation_failed');
  });
});
