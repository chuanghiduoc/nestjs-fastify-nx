import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import {
  ALL_PERMISSIONS,
  DOMAIN_EVENTS,
  PERMISSIONS,
  SYSTEM_ROLES,
} from '@nestjs-fastify-nx/shared';
import { z } from 'zod';
import { OrganizationRole } from '../../domain/entities/organization-role.entity';
import {
  PrismaOrganizationRoleRepository,
  toDeletionOutcome,
} from './prisma-organization-role.repository';
import { PrismaInvitationRepository } from './prisma-invitation.repository';
import { PrismaOrganizationRepository } from './prisma-organization.repository';
import {
  organizationDeletedPayloadSchema,
  organizationMemberRemovedPayloadSchema,
  organizationMemberRoleUpdatedPayloadSchema,
  organizationRoleChangedPayloadSchema,
} from '../../contract';

const ONE_DAY_MS = 86_400_000;
const LOCK_WAIT_POLL_MS = 20;
const FOREIGN_KEY_VIOLATION = 'P2003';
const outboxEnvelopeSchema = z.object({ payload: z.unknown() });

describe('organization repositories (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let cleaner: DatabaseCleaner;
  let roles: PrismaOrganizationRoleRepository;
  let invitations: PrismaInvitationRepository;
  let organizations: PrismaOrganizationRepository;
  let organizationId: string;
  let userId: string;
  let databaseUrl: string;

  beforeAll(async () => {
    containers = await createTestContainers();
    databaseUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = databaseUrl;
    deployTestMigrations(databaseUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();

    cleaner = new DatabaseCleaner(prisma.db);
    roles = new PrismaOrganizationRoleRepository(prisma);
    invitations = new PrismaInvitationRepository(prisma);
    organizations = new PrismaOrganizationRepository(prisma);
  }, 90_000);

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    const organization = await prisma.db.organization.create({
      data: { name: 'Integration Org', slug: 'integration-org' },
    });
    organizationId = organization.id;
    const user = await prisma.db.user.create({
      data: { name: 'Owner', email: 'owner@integration.local' },
    });
    userId = user.id;
    await prisma.db.member.create({ data: { organizationId, userId, role: 'owner' } });
  });

  async function defineRole(role: string, forOrganization = organizationId): Promise<void> {
    await roles.create(
      OrganizationRole.create({
        organizationId: forOrganization,
        role,
        permissions: [PERMISSIONS.AUDIT_LOG_READ],
        grantedToActor: ALL_PERMISSIONS,
      }),
    );
  }

  async function defineRoleOutsideTheNameRule(role: string): Promise<void> {
    await prisma.db.organizationRole.create({
      data: { organizationId, role, permission: '{}' },
    });
  }

  async function holdRoles(role: string): Promise<void> {
    await prisma.db.member.updateMany({ where: { organizationId, userId }, data: { role } });
  }

  async function createOtherOrganization(): Promise<string> {
    const other = await prisma.db.organization.create({
      data: { name: 'Other Org', slug: 'other-org' },
    });
    return other.id;
  }

  describe('findByName and update', () => {
    it('does not return a role defined by another organization', async () => {
      const otherOrganizationId = await createOtherOrganization();
      await defineRole('sales', otherOrganizationId);

      expect(await roles.findByName(organizationId, 'sales')).toBeNull();
    });

    it('updates the permissions only inside the role owner organization', async () => {
      const otherOrganizationId = await createOtherOrganization();
      await defineRole('sales');
      await defineRole('sales', otherOrganizationId);
      const role = await roles.findByName(organizationId, 'sales');
      if (!role) throw new Error('role fixture was not created');

      const updated = role.withPermissions([PERMISSIONS.FILE_READ], ALL_PERMISSIONS);

      expect(await roles.update(updated)).toBe('updated');
      expect((await roles.findByName(organizationId, 'sales'))?.permissions).toEqual([
        PERMISSIONS.FILE_READ,
      ]);
      expect((await roles.findByName(otherOrganizationId, 'sales'))?.permissions).toEqual([
        PERMISSIONS.AUDIT_LOG_READ,
      ]);
    });

    it('reports an update of a role that no longer exists', async () => {
      const ghost = OrganizationRole.create({
        organizationId,
        role: 'ghost',
        permissions: [PERMISSIONS.AUDIT_LOG_READ],
        grantedToActor: ALL_PERMISSIONS,
      });

      expect(await roles.update(ghost)).toBe('not_found');
    });

    it('lets the first of two updates from the same read win and reports the second as stale', async () => {
      await defineRole('sales');
      const read = await roles.findByName(organizationId, 'sales');
      if (!read) throw new Error('role fixture was not created');

      expect(
        await roles.update(read.withPermissions([PERMISSIONS.FILE_READ], ALL_PERMISSIONS)),
      ).toBe('updated');
      expect(
        await roles.update(read.withPermissions([PERMISSIONS.MEMBER_READ], ALL_PERMISSIONS)),
      ).toBe('stale');

      const stored = await roles.findByName(organizationId, 'sales');
      expect(stored?.permissions).toEqual([PERMISSIONS.FILE_READ]);
      expect(stored?.version).toBe(read.version + 1);
    });

    it('reports an update from a read of a role since recreated under the same name as stale', async () => {
      await defineRole('sales');
      const original = await roles.findByName(organizationId, 'sales');
      if (!original) throw new Error('role fixture was not created');
      expect(await roles.deleteUnlessHeld(organizationId, 'sales')).toBe('deleted');
      await defineRole('sales');
      const replacement = await roles.findByName(organizationId, 'sales');
      if (!replacement) throw new Error('replacement role was not created');
      expect(replacement.id).not.toBe(original.id);
      expect(replacement.version).toBe(original.version);

      expect(
        await roles.update(original.withPermissions([PERMISSIONS.FILE_READ], ALL_PERMISSIONS)),
      ).toBe('stale');

      const stored = await roles.findByName(organizationId, 'sales');
      expect(stored?.id).toBe(replacement.id);
      expect(stored?.permissions).toEqual([PERMISSIONS.AUDIT_LOG_READ]);
      expect(stored?.version).toBe(replacement.version);
    });

    it('bumps the version when a permission edit bypasses the API', async () => {
      await defineRole('sales');
      const read = await roles.findByName(organizationId, 'sales');
      if (!read) throw new Error('role fixture was not created');

      await prisma.db
        .$executeRaw`UPDATE "organization_roles" SET "permission" = '{}' WHERE "organizationId" = ${organizationId}::uuid AND "role" = 'sales'`;

      expect((await roles.findByName(organizationId, 'sales'))?.version).toBe(read.version + 1);
      expect(
        await roles.update(read.withPermissions([PERMISSIONS.FILE_READ], ALL_PERMISSIONS)),
      ).toBe('stale');
    });
  });

  describe('deleteUnlessHeld', () => {
    it('keeps a role whose name contains the letter s while a member holds it', async () => {
      await defineRole('sales');
      await holdRoles('owner, sales');

      expect(await roles.deleteUnlessHeld(organizationId, 'sales')).toBe('in_use');
      expect(await roles.findByName(organizationId, 'sales')).not.toBeNull();
    });

    it('deletes the role once nobody holds it', async () => {
      await defineRole('sales');

      expect(await roles.deleteUnlessHeld(organizationId, 'sales')).toBe('deleted');
      expect(await roles.findByName(organizationId, 'sales')).toBeNull();
    });

    it('does not mistake a longer role name for a holder', async () => {
      await defineRole('sales');
      await defineRole('salesperson');
      await holdRoles('owner,salesperson');

      expect(await roles.deleteUnlessHeld(organizationId, 'sales')).toBe('deleted');
    });

    it('ignores a holder that belongs to another organization', async () => {
      const otherOrganizationId = await createOtherOrganization();
      await defineRole('sales');
      await defineRole('sales', otherOrganizationId);
      await prisma.db.member.create({
        data: { organizationId: otherOrganizationId, userId, role: 'sales' },
      });

      expect(await roles.deleteUnlessHeld(organizationId, 'sales')).toBe('deleted');
      expect(await roles.findByName(otherOrganizationId, 'sales')).not.toBeNull();
    });

    it('keeps a role whose name holds an inner space while a member holds it', async () => {
      await defineRoleOutsideTheNameRule('sales lead');
      await defineRoleOutsideTheNameRule('saleslead');
      await holdRoles('owner, sales lead');

      expect(await roles.deleteUnlessHeld(organizationId, 'sales lead')).toBe('in_use');
      expect(await roles.deleteUnlessHeld(organizationId, 'saleslead')).toBe('deleted');
    });

    it('reports a role that was never defined as not found', async () => {
      expect(await roles.deleteUnlessHeld(organizationId, 'ghost')).toBe('not_found');
    });

    it('reports a role that a concurrent request already deleted as not found', () => {
      expect(toDeletionOutcome({ found: true, holders: 0, deleted: false })).toBe('not_found');
      expect(toDeletionOutcome({ found: true, holders: 2, deleted: false })).toBe('in_use');
      expect(toDeletionOutcome(undefined)).toBe('not_found');
    });
  });

  describe('role assignment racing role deletion', () => {
    let assigner: Client;
    let observer: Client;

    beforeEach(async () => {
      assigner = new Client({ connectionString: databaseUrl });
      observer = new Client({ connectionString: databaseUrl });
      await Promise.all([assigner.connect(), observer.connect()]);
    });

    afterEach(async () => {
      await Promise.all([assigner.end(), observer.end()]);
    });

    async function waitUntilBlockedOrSettled(pending: Promise<unknown>): Promise<void> {
      let settled = false;
      void pending.then(
        () => (settled = true),
        () => (settled = true),
      );
      while (!settled) {
        const { rows } = await observer.query<{ waiting: number }>(
          `SELECT COUNT(*)::int AS "waiting" FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if ((rows[0]?.waiting ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
      }
    }

    function rejectedBy(constraint: string): object {
      return {
        code: FOREIGN_KEY_VIOLATION,
        meta: { driverAdapterError: { cause: { constraint: { index: constraint } } } },
      };
    }

    async function heldRole(): Promise<string | undefined> {
      const member = await prisma.db.member.findFirst({ where: { organizationId, userId } });
      return member?.role;
    }

    it('keeps a role that a concurrent assignment grants before the delete commits', async () => {
      await defineRole('sales');
      await assigner.query('BEGIN');
      await assigner.query(
        `UPDATE "members" SET "role" = 'owner,sales' WHERE "organizationId" = $1 AND "userId" = $2`,
        [organizationId, userId],
      );

      const deletion = roles.deleteUnlessHeld(organizationId, 'sales');
      await waitUntilBlockedOrSettled(deletion);
      await assigner.query('COMMIT');

      expect(await deletion).toBe('in_use');
      expect(await roles.findByName(organizationId, 'sales')).not.toBeNull();
      expect(await heldRole()).toBe('owner,sales');
    });

    it('refuses an assignment of a role that a concurrent delete removes first', async () => {
      await defineRole('sales');
      await assigner.query('BEGIN');
      await assigner.query(
        `DELETE FROM "organization_roles" WHERE "organizationId" = $1 AND "role" = 'sales'`,
        [organizationId],
      );

      const assignment = prisma.db.member.updateMany({
        where: { organizationId, userId },
        data: { role: 'owner,sales' },
      });
      const settled = assignment.then(
        () => 'assigned',
        () => 'refused',
      );
      await waitUntilBlockedOrSettled(settled);
      await assigner.query('COMMIT');

      expect(await settled).toBe('refused');
      expect(await heldRole()).toBe('owner');
    });

    it('refuses to assign a custom role the organization never defined', async () => {
      await expect(holdRoles('owner, ghost')).rejects.toMatchObject(
        rejectedBy('members_role_defined'),
      );
      expect(await heldRole()).toBe('owner');
    });

    it('matches a held role by its trimmed name and keeps inner spaces', async () => {
      await defineRoleOutsideTheNameRule('sales lead');

      await holdRoles(' owner ,  sales lead ');
      expect(await heldRole()).toBe(' owner ,  sales lead ');
      await expect(holdRoles('owner, saleslead')).rejects.toMatchObject(
        rejectedBy('members_role_defined'),
      );
    });

    it('assigns every system role without a tenant-defined row', async () => {
      await holdRoles(Object.values(SYSTEM_ROLES).join(', '));

      expect(await heldRole()).toBe(Object.values(SYSTEM_ROLES).join(', '));
    });

    it('keeps a role a member already held when that member gains another role', async () => {
      await defineRole('sales');
      await defineRole('support');
      await holdRoles('owner, sales');
      await prisma.db
        .$executeRaw`ALTER TABLE "organization_roles" DISABLE TRIGGER "organization_roles_unheld"`;
      try {
        await prisma.db.organizationRole.deleteMany({ where: { organizationId, role: 'sales' } });
      } finally {
        await prisma.db
          .$executeRaw`ALTER TABLE "organization_roles" ENABLE TRIGGER "organization_roles_unheld"`;
      }

      await holdRoles('owner, sales, support');

      expect(await heldRole()).toBe('owner, sales, support');
    });

    it('refuses to rename a role that a member holds', async () => {
      await defineRole('sales');
      await holdRoles('owner, sales');

      await expect(
        prisma.db.organizationRole.updateMany({
          where: { organizationId, role: 'sales' },
          data: { role: 'closers' },
        }),
      ).rejects.toMatchObject(rejectedBy('organization_roles_unheld'));
      expect(await roles.findByName(organizationId, 'sales')).not.toBeNull();
    });

    it('still deletes an organization together with its held custom roles', async () => {
      await defineRole('sales');
      await holdRoles('owner, sales');

      await prisma.db.organization.delete({ where: { id: organizationId } });

      expect(await prisma.db.organizationRole.count({ where: { organizationId } })).toBe(0);
    });
  });

  describe('trigger payloads', () => {
    async function storedPayloads(eventType: string): Promise<unknown[]> {
      const rows = await prisma.db.outboxEvent.findMany({
        where: { eventType, aggregateId: organizationId },
      });
      return rows.map((row) => outboxEnvelopeSchema.parse(row.payload).payload);
    }

    it('stores payloads that satisfy the published organization contract', async () => {
      await defineRole('sales');
      const role = await roles.findByName(organizationId, 'sales');
      if (!role) throw new Error('role fixture was not created');
      await roles.update(role.withPermissions([PERMISSIONS.FILE_READ], ALL_PERMISSIONS));
      expect(await roles.deleteUnlessHeld(organizationId, 'sales')).toBe('deleted');
      await holdRoles(SYSTEM_ROLES.ADMIN);
      await prisma.db.member.deleteMany({ where: { organizationId, userId } });
      await prisma.db.organization.delete({ where: { id: organizationId } });

      const roleChanges = (await storedPayloads(DOMAIN_EVENTS.ORGANIZATIONS_ROLE_CHANGED))
        .map((payload) => organizationRoleChangedPayloadSchema.parse(payload))
        .sort((left, right) => left.action.localeCompare(right.action));
      expect(roleChanges).toEqual([
        { role: 'sales', action: 'DELETE' },
        { role: 'sales', action: 'INSERT' },
        { role: 'sales', action: 'UPDATE' },
      ]);
      const [roleUpdate] = await storedPayloads(DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ROLE_UPDATED);
      expect(organizationMemberRoleUpdatedPayloadSchema.parse(roleUpdate)).toEqual({
        userId,
        oldRole: SYSTEM_ROLES.OWNER,
        role: SYSTEM_ROLES.ADMIN,
      });
      const [removal] = await storedPayloads(DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_REMOVED);
      expect(organizationMemberRemovedPayloadSchema.parse(removal)).toEqual({
        userId,
        role: SYSTEM_ROLES.ADMIN,
      });
      const [deletion] = await storedPayloads(DOMAIN_EVENTS.ORGANIZATIONS_DELETED);
      expect(organizationDeletedPayloadSchema.parse(deletion)).toEqual({
        name: 'Integration Org',
        slug: 'integration-org',
      });
    });
  });

  describe('invitation by id', () => {
    async function createInvitation(forOrganization: string, status = 'pending'): Promise<string> {
      const invitation = await prisma.db.invitation.create({
        data: {
          organizationId: forOrganization,
          email: `${status}-${forOrganization}@example.com`,
          status,
          expiresAt: new Date(Date.now() + ONE_DAY_MS),
          inviterId: userId,
        },
      });
      return invitation.id;
    }

    it('does not find an invitation that belongs to another organization', async () => {
      const otherOrganizationId = await createOtherOrganization();
      const id = await createInvitation(otherOrganizationId);

      expect(await invitations.findById(organizationId, id)).toBeNull();
      expect((await invitations.findById(otherOrganizationId, id))?.id).toBe(id);
    });

    it('cancels a pending invitation exactly once', async () => {
      const id = await createInvitation(organizationId);

      expect(await invitations.cancelPending(organizationId, id)).toBe(true);
      expect(await invitations.cancelPending(organizationId, id)).toBe(false);
      expect((await invitations.findById(organizationId, id))?.status).toBe('canceled');
    });

    it('does not cancel an invitation that is no longer pending', async () => {
      const id = await createInvitation(organizationId, 'accepted');

      expect(await invitations.cancelPending(organizationId, id)).toBe(false);
      expect((await invitations.findById(organizationId, id))?.status).toBe('accepted');
    });

    it('does not cancel an invitation that belongs to another organization', async () => {
      const otherOrganizationId = await createOtherOrganization();
      const id = await createInvitation(otherOrganizationId);

      expect(await invitations.cancelPending(organizationId, id)).toBe(false);
      expect((await invitations.findById(otherOrganizationId, id))?.status).toBe('pending');
    });
  });

  describe('pending invitations', () => {
    beforeEach(async () => {
      await prisma.db.invitation.createMany({
        data: [
          {
            organizationId,
            email: 'expired@example.com',
            status: 'pending',
            expiresAt: new Date(Date.now() - ONE_DAY_MS),
            inviterId: userId,
          },
          {
            organizationId,
            email: 'live@example.com',
            status: 'pending',
            expiresAt: new Date(Date.now() + ONE_DAY_MS),
            inviterId: userId,
          },
          {
            organizationId,
            email: 'accepted@example.com',
            status: 'accepted',
            expiresAt: new Date(Date.now() + ONE_DAY_MS),
            inviterId: userId,
          },
        ],
      });
    });

    it('lists only the invitations that can still be accepted as pending', async () => {
      const result = await invitations.findAllCursor({
        organizationId,
        limit: 10,
        status: 'pending',
      });

      expect(result.items.map((invitation) => invitation.email)).toEqual(['live@example.com']);
    });

    it('counts only the invitations that can still be accepted in the summary', async () => {
      const summary = await organizations.findSummary(organizationId);

      expect(summary?.pendingInvitationCount).toBe(1);
    });
  });
});
