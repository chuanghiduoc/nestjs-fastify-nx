import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PERMISSIONS, generateId, serializePermissionStatements } from '@nestjs-fastify-nx/shared';
import { OrganizationRole } from '../../domain/entities/organization-role.entity';
import { Team } from '../../domain/entities/team.entity';
import { PrismaOrganizationRoleRepository } from './prisma-organization-role.repository';
import { PrismaTeamRepository } from './prisma-team.repository';
import { PrismaInvitationRepository } from './prisma-invitation.repository';
import { PrismaOrganizationRepository } from './prisma-organization.repository';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91600001';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: {},
  });
}

function prismaDouble(model: string, methods: Record<string, unknown>): PrismaService {
  const db = { [model]: methods };
  return {
    db,
    readTarget: () => db,
    writeTarget: () => db,
  } as unknown as PrismaService;
}

describe('PrismaOrganizationRoleRepository', () => {
  it('reads permissions back out of the persisted wire format', async () => {
    const prisma = prismaDouble('organizationRole', {
      findMany: vi.fn().mockResolvedValue([
        {
          id: generateId(),
          organizationId: ORG_ID,
          role: 'auditor',
          permission: serializePermissionStatements([PERMISSIONS.AUDIT_LOG_READ]),
          createdAt: new Date(),
          updatedAt: null,
        },
      ]),
    });

    const roles = await new PrismaOrganizationRoleRepository(prisma).findAll(ORG_ID);

    expect(roles).toHaveLength(1);
    expect(roles[0].permissions).toEqual([PERMISSIONS.AUDIT_LOG_READ]);
  });

  it('translates a duplicate role into a domain conflict', async () => {
    const prisma = prismaDouble('organizationRole', {
      create: vi.fn().mockRejectedValue(uniqueViolation()),
    });
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
    });

    await expect(new PrismaOrganizationRoleRepository(prisma).create(role)).rejects.toMatchObject({
      kind: 'conflict',
    });
  });

  it('rethrows a Prisma error it cannot describe better', async () => {
    const failure = new Error('connection lost');
    const prisma = prismaDouble('organizationRole', {
      create: vi.fn().mockRejectedValue(failure),
    });
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
    });

    await expect(new PrismaOrganizationRoleRepository(prisma).create(role)).rejects.toBe(failure);
  });

  it('reports whether the delete matched a row', async () => {
    const deleteMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({
      count: 0,
    });
    const repository = new PrismaOrganizationRoleRepository(
      prismaDouble('organizationRole', { deleteMany }),
    );

    expect(await repository.delete(ORG_ID, 'auditor')).toBe(true);
    expect(await repository.delete(ORG_ID, 'auditor')).toBe(false);
  });

  it('counts holders through a comma-aware SQL predicate', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ count: 2 }]);
    const prisma = { readTarget: () => ({ $queryRaw: queryRaw }) } as unknown as PrismaService;

    const count = await new PrismaOrganizationRoleRepository(prisma).countMembersHolding(
      ORG_ID,
      'auditor',
    );

    expect(count).toBe(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('treats an empty count result as zero holders', async () => {
    const prisma = {
      readTarget: () => ({ $queryRaw: vi.fn().mockResolvedValue([]) }),
    } as unknown as PrismaService;

    expect(
      await new PrismaOrganizationRoleRepository(prisma).countMembersHolding(ORG_ID, 'auditor'),
    ).toBe(0);
  });
});

describe('PrismaTeamRepository', () => {
  function teamRow(overrides: Record<string, unknown> = {}) {
    return {
      id: generateId(),
      organizationId: ORG_ID,
      name: 'Platform',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: null,
      _count: { members: 3 },
      ...overrides,
    };
  }

  it('always scopes the listing to the organization', async () => {
    const findMany = vi.fn().mockResolvedValue([teamRow()]);
    const repository = new PrismaTeamRepository(prismaDouble('team', { findMany }));

    await repository.findAllCursor({ organizationId: ORG_ID, limit: 10 });

    expect(findMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG_ID });
  });

  it('escapes LIKE metacharacters in the search term', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaTeamRepository(prismaDouble('team', { findMany }));

    await repository.findAllCursor({ organizationId: ORG_ID, limit: 10, search: '50%_off' });

    expect(findMany.mock.calls[0][0].where.name.contains).toBe('50\\%\\_off');
  });

  it('adds a keyset predicate when a cursor is supplied', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaTeamRepository(prismaDouble('team', { findMany }));
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const id = generateId();

    await repository.findAllCursor({
      organizationId: ORG_ID,
      limit: 10,
      startingAfter: { createdAt, id },
    });

    expect(findMany.mock.calls[0][0].where.AND[0].OR).toEqual([
      { createdAt: { lt: createdAt } },
      { AND: [{ createdAt }, { id: { lt: id } }] },
    ]);
  });

  it('reports hasMore by over-fetching one row', async () => {
    const findMany = vi.fn().mockResolvedValue([teamRow(), teamRow(), teamRow()]);
    const repository = new PrismaTeamRepository(prismaDouble('team', { findMany }));

    const result = await repository.findAllCursor({ organizationId: ORG_ID, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('carries the member count onto the entity, defaulting to zero', async () => {
    const findMany = vi.fn().mockResolvedValue([teamRow({ _count: undefined })]);
    const repository = new PrismaTeamRepository(prismaDouble('team', { findMany }));

    const result = await repository.findAllCursor({ organizationId: ORG_ID, limit: 10 });

    expect(result.items[0].memberCount).toBe(0);
  });

  it('translates a duplicate team name into a domain conflict', async () => {
    const repository = new PrismaTeamRepository(
      prismaDouble('team', { create: vi.fn().mockRejectedValue(uniqueViolation()) }),
    );

    await expect(
      repository.create(Team.create({ organizationId: ORG_ID, name: 'Platform' })),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('translates a duplicate name on rename too', async () => {
    const repository = new PrismaTeamRepository(
      prismaDouble('team', { update: vi.fn().mockRejectedValue(uniqueViolation()) }),
    );

    await expect(
      repository.update(Team.create({ organizationId: ORG_ID, name: 'Platform' })),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('scopes findById to the organization', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaTeamRepository(prismaDouble('team', { findFirst }));
    const id = generateId();

    expect(await repository.findById(ORG_ID, id)).toBeNull();
    expect(findFirst.mock.calls[0][0].where).toEqual({ id, organizationId: ORG_ID });
  });

  it('reports whether the delete matched a row', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaTeamRepository(prismaDouble('team', { deleteMany }));

    expect(await repository.delete(ORG_ID, generateId())).toBe(false);
  });
});

describe('PrismaInvitationRepository', () => {
  function invitationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: generateId(),
      organizationId: ORG_ID,
      email: 'invitee@example.com',
      role: 'member',
      teamId: null,
      status: 'pending',
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      inviterId: generateId(),
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('lowercases the email filter and scopes to the organization', async () => {
    const findMany = vi.fn().mockResolvedValue([invitationRow()]);
    const repository = new PrismaInvitationRepository(prismaDouble('invitation', { findMany }));

    await repository.findAllCursor({
      organizationId: ORG_ID,
      limit: 10,
      status: 'pending',
      email: 'INVITEE@example.com',
    });

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG_ID,
      status: 'pending',
      email: 'invitee@example.com',
    });
  });

  it('cancels only a row that is still pending', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaInvitationRepository(prismaDouble('invitation', { updateMany }));
    const id = generateId();

    expect(await repository.cancelPending(ORG_ID, id)).toBe(false);
    expect(updateMany.mock.calls[0][0].where).toEqual({
      id,
      organizationId: ORG_ID,
      status: 'pending',
    });
  });

  it('returns null for an invitation of another organization', async () => {
    const repository = new PrismaInvitationRepository(
      prismaDouble('invitation', { findFirst: vi.fn().mockResolvedValue(null) }),
    );

    expect(await repository.findById(ORG_ID, generateId())).toBeNull();
  });
});

describe('PrismaOrganizationRepository', () => {
  it('projects the counted relations into the summary', async () => {
    const prisma = prismaDouble('organization', {
      findUnique: vi.fn().mockResolvedValue({
        id: ORG_ID,
        name: 'Acme',
        slug: 'acme',
        logo: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        _count: { members: 4, teams: 2, invitations: 1 },
      }),
    });

    const summary = await new PrismaOrganizationRepository(prisma).findSummary(ORG_ID);

    expect(summary).toMatchObject({ memberCount: 4, teamCount: 2, pendingInvitationCount: 1 });
  });

  it('returns null when the organization is gone', async () => {
    const prisma = prismaDouble('organization', {
      findUnique: vi.fn().mockResolvedValue(null),
    });

    expect(await new PrismaOrganizationRepository(prisma).findSummary(ORG_ID)).toBeNull();
  });
});
