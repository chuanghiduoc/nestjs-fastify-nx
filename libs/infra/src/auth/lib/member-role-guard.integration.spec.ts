import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { I18nService } from 'nestjs-i18n';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
  provisionRlsRole,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { SYSTEM_ROLES, serializePermissionStatements } from '@nestjs-fastify-nx/shared';
import { createBetterAuth, type BetterAuthInstance } from './better-auth.config';
import { MEMBER_ROLE_NOT_DEFINED_MESSAGE } from './member-role-guard';

const PASSWORD = 'correct-horse-battery-staple';
const ANALYST_ROLE = 'analyst';
const INVITEE_EMAIL = 'invitee@roles.test';

const undefinedRoleRejection = {
  statusCode: 404,
  body: {
    code: ERROR_CODES.ORGANIZATION_ROLE_NOT_FOUND,
    message: MEMBER_ROLE_NOT_DEFINED_MESSAGE,
  },
};

describe('Better Auth member role guard (integration)', () => {
  let containers: TestContainers;
  let admin: PrismaService;
  let tenant: PrismaService;
  let cleaner: DatabaseCleaner;
  let auth: BetterAuthInstance;

  async function signUp(email: string): Promise<{ userId: string; headers: Headers }> {
    const { headers, response } = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: email },
      returnHeaders: true,
    });
    const cookie = headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');
    return { userId: response.user.id, headers: new Headers({ cookie }) };
  }

  async function signUpVerified(email: string): Promise<{ userId: string; headers: Headers }> {
    const account = await signUp(email);
    await admin.db.user.update({ where: { id: account.userId }, data: { emailVerified: true } });
    return account;
  }

  async function createPersonalOrganization(userId: string): Promise<string> {
    const personal = await admin.db.organization.create({
      data: { name: 'Personal', slug: `personal-${userId}` },
    });
    return personal.id;
  }

  async function defineAnalystRole(organizationId: string): Promise<void> {
    await admin.db.organizationRole.create({
      data: {
        organizationId,
        role: ANALYST_ROLE,
        permission: serializePermissionStatements(['audit_log:read']),
      },
    });
  }

  async function memberRole(organizationId: string, userId: string): Promise<string | undefined> {
    const member = await admin.db.member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    return member?.role;
  }

  beforeAll(async () => {
    containers = await createTestContainers();
    const adminUrl = containers.postgres.getConnectionUri();
    deployTestMigrations(adminUrl);

    process.env['DATABASE_URL'] = adminUrl;
    admin = new PrismaService();
    await admin.onModuleInit();
    cleaner = new DatabaseCleaner(admin.db);

    process.env['DATABASE_URL'] = await provisionRlsRole(adminUrl);
    tenant = new PrismaService();
    await tenant.onModuleInit();
    auth = createBetterAuth(tenant.db, { send: () => Promise.resolve() }, {} as I18nService, {
      resolveOrganizationId: createPersonalOrganization,
    });
  }, 120_000);

  afterAll(async () => {
    await tenant?.onApplicationShutdown();
    await admin?.onApplicationShutdown();
    await containers?.teardown();
  });

  let organizationId: string;
  let owner: { userId: string; headers: Headers };

  beforeEach(async () => {
    await cleaner.truncateAll();
    owner = await signUp('owner@roles.test');
    const organization = await auth.api.createOrganization({
      headers: owner.headers,
      body: { name: 'Roles', slug: 'roles' },
    });
    organizationId = organization.id;
    await defineAnalystRole(organizationId);
  });

  async function inviteAnalyst(): Promise<string> {
    const invitation = await auth.api.createInvitation({
      headers: owner.headers,
      body: { email: INVITEE_EMAIL, role: ANALYST_ROLE, organizationId },
    });
    return invitation.id;
  }

  it('accepts an invitation whose custom role still exists', async () => {
    const invitationId = await inviteAnalyst();
    const invitee = await signUpVerified(INVITEE_EMAIL);

    await auth.api.acceptInvitation({ headers: invitee.headers, body: { invitationId } });

    expect(await memberRole(organizationId, invitee.userId)).toBe(ANALYST_ROLE);
  });

  it('refuses an invitation whose custom role was deleted after it was sent', async () => {
    const invitationId = await inviteAnalyst();
    await admin.db.organizationRole.deleteMany({ where: { organizationId, role: ANALYST_ROLE } });
    const invitee = await signUpVerified(INVITEE_EMAIL);

    await expect(
      auth.api.acceptInvitation({ headers: invitee.headers, body: { invitationId } }),
    ).rejects.toMatchObject(undefinedRoleRejection);
    expect(await memberRole(organizationId, invitee.userId)).toBeUndefined();
  });

  it('refuses to give a member a custom role the organization does not define', async () => {
    const colleague = await signUp('colleague@roles.test');
    const member = await admin.db.member.create({
      data: { organizationId, userId: colleague.userId, role: SYSTEM_ROLES.MEMBER },
    });

    await expect(
      auth.api.updateMemberRole({
        headers: owner.headers,
        body: { memberId: member.id, role: 'ghost', organizationId },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await memberRole(organizationId, colleague.userId)).toBe(SYSTEM_ROLES.MEMBER);
  });

  it('gives a member a custom role the organization defines', async () => {
    const colleague = await signUp('colleague@roles.test');
    const member = await admin.db.member.create({
      data: { organizationId, userId: colleague.userId, role: SYSTEM_ROLES.MEMBER },
    });

    await auth.api.updateMemberRole({
      headers: owner.headers,
      body: { memberId: member.id, role: [SYSTEM_ROLES.MEMBER, ANALYST_ROLE], organizationId },
    });

    expect(await memberRole(organizationId, colleague.userId)).toBe(
      `${SYSTEM_ROLES.MEMBER},${ANALYST_ROLE}`,
    );
  });
});
