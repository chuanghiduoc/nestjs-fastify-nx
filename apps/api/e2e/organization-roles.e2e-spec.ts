import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PERMISSIONS, SYSTEM_ROLES } from '@nestjs-fastify-nx/shared';
import { createTestApp, cookieHeaderFromSetCookies, type TestAppContext } from './test-app';

describe('Organization roles and teams E2E', () => {
  let ctx: TestAppContext;
  let cookie: string;
  let organizationId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);

  beforeEach(async () => {
    await ctx.cleaner.truncateAll();
    const email = `roles-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const signUp = await request(ctx.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password123', name: 'Owner' });
    cookie = cookieHeaderFromSetCookies(signUp.headers['set-cookie']);

    const membership = await ctx.app.get(PrismaService).db.member.findFirstOrThrow();
    organizationId = membership.organizationId;
  });

  describe('roles', () => {
    it('lists the system roles before any custom role exists', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .expect(200);

      const names = res.body.data.map((role: { role: string }) => role.role);
      expect(names).toEqual(expect.arrayContaining(Object.values(SYSTEM_ROLES)));
      expect(res.body.data.every((role: { system: boolean }) => role.system)).toBe(true);
    });

    it('creates a custom role and reads it back', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send({ role: 'auditor', permissions: [PERMISSIONS.AUDIT_LOG_READ] })
        .expect(201);

      expect(created.body.system).toBe(false);
      expect(created.body.permissions).toEqual([PERMISSIONS.AUDIT_LOG_READ]);

      const listed = await request(ctx.app.getHttpServer())
        .get('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .expect(200);

      const custom = listed.body.data.filter((role: { system: boolean }) => !role.system);
      expect(custom).toHaveLength(1);
      expect(custom[0].role).toBe('auditor');
    });

    // The role is written in the format Better Auth reads, so the PBAC guard resolves the same
    // permissions the tenant just defined.
    it('makes a member holding the new role pass the guard that permission gates', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send({ role: 'auditor', permissions: [PERMISSIONS.AUDIT_LOG_READ] })
        .expect(201);

      await ctx.app.get(PrismaService).db.member.updateMany({ data: { role: 'auditor' } });

      await request(ctx.app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Cookie', cookie)
        .expect(200);
      await request(ctx.app.getHttpServer())
        .get('/api/v1/organizations/current/teams')
        .set('Cookie', cookie)
        .expect(403);
    });

    it('rejects a role name that shadows a system role with 422', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send({ role: 'owner', permissions: [PERMISSIONS.AUDIT_LOG_READ] })
        .expect(422);

      expect(res.body.status).toBe(422);
    });

    it('rejects a permission outside the catalog with 422', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send({ role: 'auditor', permissions: ['file:teleport'] })
        .expect(422);
    });

    it('reports a duplicate role name as 409', async () => {
      const body = { role: 'auditor', permissions: [PERMISSIONS.AUDIT_LOG_READ] };
      await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send(body)
        .expect(201);

      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send(body)
        .expect(409);

      expect(res.body.code).toBe('organization_role_already_exists');
    });

    it('replaces the permission set on update', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send({ role: 'auditor', permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.TEAM_READ] })
        .expect(201);

      const updated = await request(ctx.app.getHttpServer())
        .patch('/api/v1/organizations/current/roles/auditor')
        .set('Cookie', cookie)
        .send({ permissions: [PERMISSIONS.TEAM_READ] })
        .expect(200);

      expect(updated.body.permissions).toEqual([PERMISSIONS.TEAM_READ]);
    });

    it('refuses to delete a role a member still holds', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send({ role: 'auditor', permissions: [PERMISSIONS.ROLE_DELETE] })
        .expect(201);
      await ctx.app.get(PrismaService).db.member.updateMany({ data: { role: 'auditor' } });

      const res = await request(ctx.app.getHttpServer())
        .delete('/api/v1/organizations/current/roles/auditor')
        .set('Cookie', cookie)
        .expect(409);

      expect(res.body.code).toBe('organization_role_in_use');
    });

    it('deletes a role nobody holds', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/roles')
        .set('Cookie', cookie)
        .send({ role: 'auditor', permissions: [PERMISSIONS.AUDIT_LOG_READ] })
        .expect(201);

      await request(ctx.app.getHttpServer())
        .delete('/api/v1/organizations/current/roles/auditor')
        .set('Cookie', cookie)
        .expect(204);
    });

    it('answers 404 for an unknown role', async () => {
      await request(ctx.app.getHttpServer())
        .delete('/api/v1/organizations/current/roles/ghost')
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  describe('teams', () => {
    it('creates, lists, renames and deletes a team', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/teams')
        .set('Cookie', cookie)
        .send({ name: 'Platform' })
        .expect(201);

      const listed = await request(ctx.app.getHttpServer())
        .get('/api/v1/organizations/current/teams')
        .set('Cookie', cookie)
        .expect(200);
      expect(listed.body.object).toBe('list');
      expect(listed.body.data).toHaveLength(1);
      expect(listed.body.data[0].memberCount).toBe(0);

      const renamed = await request(ctx.app.getHttpServer())
        .patch(`/api/v1/organizations/current/teams/${created.body.id}`)
        .set('Cookie', cookie)
        .send({ name: 'Infrastructure' })
        .expect(200);
      expect(renamed.body.name).toBe('Infrastructure');

      await request(ctx.app.getHttpServer())
        .delete(`/api/v1/organizations/current/teams/${created.body.id}`)
        .set('Cookie', cookie)
        .expect(204);
    });

    it('reports a duplicate team name as 409', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/teams')
        .set('Cookie', cookie)
        .send({ name: 'Platform' })
        .expect(201);

      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/organizations/current/teams')
        .set('Cookie', cookie)
        .send({ name: 'Platform' })
        .expect(409);

      expect(res.body.code).toBe('team_name_taken');
    });

    it('never returns a team of another organization', async () => {
      const prisma = ctx.app.get(PrismaService).db;
      const otherOrg = await prisma.organization.create({
        data: { name: 'Other', slug: `other-${Date.now()}` },
      });
      await prisma.team.create({ data: { organizationId: otherOrg.id, name: 'Outsider' } });

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/organizations/current/teams?limit=50')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data).toHaveLength(0);
    });

    it('rejects a non-v7 uuid path param with 400', async () => {
      await request(ctx.app.getHttpServer())
        .delete('/api/v1/organizations/current/teams/123e4567-e89b-12d3-a456-426614174000')
        .set('Cookie', cookie)
        .expect(400);
    });
  });

  describe('current organization', () => {
    it('returns the active organization with its counts', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/organizations/current')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.id).toBe(organizationId);
      expect(res.body.memberCount).toBe(1);
      expect(res.body.teamCount).toBe(0);
      expect(res.body.pendingInvitationCount).toBe(0);
    });

    it('requires a session', async () => {
      await request(ctx.app.getHttpServer()).get('/api/v1/organizations/current').expect(401);
    });
  });
});
