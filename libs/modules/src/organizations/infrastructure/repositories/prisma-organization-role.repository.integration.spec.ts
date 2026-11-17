import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { ALL_PERMISSIONS, PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { OrganizationRole } from '../../domain/entities/organization-role.entity';
import {
  PrismaOrganizationRoleRepository,
  toDeletionOutcome,
} from './prisma-organization-role.repository';
import { PrismaInvitationRepository } from './prisma-invitation.repository';
import { PrismaOrganizationRepository } from './prisma-organization.repository';

const ONE_DAY_MS = 86_400_000;

describe('organization repositories (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let cleaner: DatabaseCleaner;
  let roles: PrismaOrganizationRoleRepository;
  let invitations: PrismaInvitationRepository;
  let organizations: PrismaOrganizationRepository;
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

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

      expect(await roles.update(updated)).toBe(true);
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

      expect(await roles.update(ghost)).toBe(false);
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

    it('reports a role that was never defined as not found', async () => {
      expect(await roles.deleteUnlessHeld(organizationId, 'ghost')).toBe('not_found');
    });

    it('reports a role that a concurrent request already deleted as not found', () => {
      expect(toDeletionOutcome({ found: true, holders: 0, deleted: false })).toBe('not_found');
      expect(toDeletionOutcome({ found: true, holders: 2, deleted: false })).toBe('in_use');
      expect(toDeletionOutcome(undefined)).toBe('not_found');
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
