import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  createTestApp,
  cookieHeaderFromSetCookies,
  resetRateLimitBudget,
  type TestAppContext,
} from './test-app';

describe('Audit security regressions', () => {
  let ctx: TestAppContext;
  let cookie: string;
  let userId: string;
  let email: string;
  const password = 'password123';

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);
  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    await resetRateLimitBudget();
    email = `audit-${randomUUID()}@example.com`;
    const signup = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password, name: 'Audit' })
      .expect(200);
    cookie = cookieHeaderFromSetCookies(signup.headers['set-cookie']);
    userId = signup.body.user.id as string;
  });

  it.each(['BANNED', 'INACTIVE'])(
    'rejects %s users on raw auth routes and fresh sign-in',
    async (status) => {
      const membership = await ctx.prisma.db.member.findFirstOrThrow({ where: { userId } });
      await ctx.prisma.db.user.update({ where: { id: userId }, data: { status } });
      await request(ctx.app.getHttpServer())
        .post('/api/auth/organization/update')
        .set('Cookie', cookie)
        .send({ organizationId: membership.organizationId, data: { name: 'Forbidden change' } })
        .expect(403);
      await request(ctx.app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(403);
      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password })
        .expect(403);
      const org = await ctx.prisma.db.organization.findUniqueOrThrow({
        where: { id: membership.organizationId },
      });
      expect(org.name).not.toBe('Forbidden change');
      await request(ctx.app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Cookie', cookie)
        .send({})
        .expect(200);
    },
  );

  it('creates default teams and keyed memberships through Better Auth', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/api/auth/organization/create')
      .set('Cookie', cookie)
      .send({ name: 'Team organization', slug: `audit-${randomUUID()}` })
      .expect(200);
    const organizationId = response.body.id as string;
    const team = await ctx.prisma.db.team.findFirstOrThrow({ where: { organizationId } });
    const member = await ctx.prisma.db.teamMember.findFirstOrThrow({
      where: { teamId: team.id, userId },
    });
    expect(team.memberCount).toBe(1);
    expect(member.membershipKey).toEqual(expect.any(String));
  });

  it.each(['session', 'permission', 'status'])(
    'does not replay after %s revocation',
    async (kind) => {
      const key = randomUUID();
      const send = () =>
        request(ctx.app.getHttpServer())
          .post('/api/v1/upload/presign')
          .set('Cookie', cookie)
          .set('Idempotency-Key', key)
          .send({ contentType: 'image/png' });
      await send().expect(201);
      if (kind === 'session') await ctx.prisma.db.session.deleteMany({ where: { userId } });
      if (kind === 'permission')
        await ctx.prisma.db.member.updateMany({ where: { userId }, data: { role: 'viewer' } });
      if (kind === 'status')
        await ctx.prisma.db.user.update({ where: { id: userId }, data: { status: 'BANNED' } });
      const denied = await send();
      expect(denied.status).toBe(kind === 'session' ? 401 : 403);
      expect(denied.headers['idempotent-replayed']).toBeUndefined();
    },
  );

  it('cannot replay a bearer response using its unrelated forged cookie', async () => {
    const key = randomUUID();
    const tokenCookie = cookie
      .split('; ')
      .find((part) => part.startsWith('better-auth.session_token='));
    expect(tokenCookie).toBeDefined();
    if (!tokenCookie) throw new Error('Signup did not return a session token cookie');
    const token = decodeURIComponent(tokenCookie.slice('better-auth.session_token='.length));
    const forgedCookie = 'better-auth.session_token=attacker-selected';
    await request(ctx.app.getHttpServer())
      .post('/api/v1/upload/presign')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', forgedCookie)
      .set('Idempotency-Key', key)
      .send({ contentType: 'image/png' })
      .expect(201);
    const denied = await request(ctx.app.getHttpServer())
      .post('/api/v1/upload/presign')
      .set('Cookie', forgedCookie)
      .set('Idempotency-Key', key)
      .send({ contentType: 'image/png' })
      .expect(401);
    expect(denied.headers['idempotent-replayed']).toBeUndefined();
  });

  it('does not replay the previous organization after a session switches tenants', async () => {
    const key = randomUUID();
    const send = () =>
      request(ctx.app.getHttpServer())
        .post('/api/v1/upload/presign')
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send({ contentType: 'image/png' });
    const first = await send().expect(201);
    const org = await ctx.prisma.db.organization.create({
      data: { name: 'Second', slug: `second-${randomUUID()}` },
    });
    await ctx.prisma.db.member.create({ data: { organizationId: org.id, userId, role: 'owner' } });
    await ctx.prisma.db.session.updateMany({
      where: { userId },
      data: { activeOrganizationId: org.id },
    });
    const second = await send().expect(201);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(second.body).not.toEqual(first.body);
  });
});
