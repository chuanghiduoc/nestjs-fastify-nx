import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainException, type AuthorizationPort } from '@nestjs-fastify-nx/core';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLES,
  generateId,
  type Permission,
} from '@nestjs-fastify-nx/shared';
import { OrganizationRole } from '../domain/entities/organization-role.entity';
import { Team } from '../domain/entities/team.entity';
import {
  InMemoryInvitationRepository,
  InMemoryOrganizationRepository,
  InMemoryOrganizationRoleRepository,
  InMemoryTeamRepository,
} from '../testing/in-memory-repositories';
import type { OrganizationRoleRepositoryPort } from '../domain/ports/organization-role-repository.port';
import type { TeamRepositoryPort } from '../domain/ports/team-repository.port';
import { ListOrganizationRolesHandler } from './queries/list-organization-roles';
import { ListOrganizationRolesQuery } from './queries/list-organization-roles';
import { CreateOrganizationRoleHandler } from './commands/create-organization-role';
import { CreateOrganizationRoleCommand } from './commands/create-organization-role';
import { UpdateOrganizationRoleHandler } from './commands/update-organization-role';
import { UpdateOrganizationRoleCommand } from './commands/update-organization-role';
import { DeleteOrganizationRoleHandler } from './commands/delete-organization-role';
import { DeleteOrganizationRoleCommand } from './commands/delete-organization-role';
import { ListTeamsHandler } from './queries/list-teams';
import { ListTeamsQuery } from './queries/list-teams';
import { CreateTeamHandler } from './commands/create-team';
import { CreateTeamCommand } from './commands/create-team';
import { UpdateTeamHandler } from './commands/update-team';
import { UpdateTeamCommand } from './commands/update-team';
import { DeleteTeamHandler } from './commands/delete-team';
import { DeleteTeamCommand } from './commands/delete-team';
import { ListInvitationsHandler } from './queries/list-invitations';
import { ListInvitationsQuery } from './queries/list-invitations';
import { CancelInvitationHandler } from './commands/cancel-invitation';
import { CancelInvitationCommand } from './commands/cancel-invitation';
import { GetCurrentOrganizationHandler } from './queries/get-current-organization';
import { GetCurrentOrganizationQuery } from './queries/get-current-organization';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90700001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef90700002';
const INVITER_ID = '019dd1a5-9235-70db-8d57-54ef90700003';
const ACTOR_ID = generateId();
const ONE_DAY_MS = 86_400_000;

function authorizationHolding(permissions: readonly Permission[]): AuthorizationPort {
  return {
    permissionsFor: vi.fn().mockResolvedValue(permissions),
  } as unknown as AuthorizationPort;
}

function roleCommand(role: string, permissions: readonly string[]) {
  return { organizationId: ORG_ID, actorUserId: ACTOR_ID, role, permissions };
}

describe('organization role handlers', () => {
  let roles: InMemoryOrganizationRoleRepository;

  beforeEach(() => {
    roles = new InMemoryOrganizationRoleRepository();
  });

  it('lists the system roles alongside the tenant-defined ones', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: ORG_ID,
        grantedToActor: ALL_PERMISSIONS,
        role: 'auditor',
        permissions: [PERMISSIONS.AUDIT_LOG_READ],
      }),
    );

    const result = await new ListOrganizationRolesHandler(roles).execute(
      new ListOrganizationRolesQuery(ORG_ID),
    );

    const systemNames = result.data.filter((role) => role.system).map((role) => role.role);
    const customNames = result.data.filter((role) => !role.system).map((role) => role.role);

    expect(systemNames.sort()).toEqual(Object.values(SYSTEM_ROLES).sort());
    expect(customNames).toEqual(['auditor']);
    expect(result.data.find((role) => role.system)?.id).toBeNull();
  });

  it('does not leak roles defined by another organization', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: OTHER_ORG_ID,
        grantedToActor: ALL_PERMISSIONS,
        role: 'auditor',
        permissions: [PERMISSIONS.AUDIT_LOG_READ],
      }),
    );

    const result = await new ListOrganizationRolesHandler(roles).execute(
      new ListOrganizationRolesQuery(ORG_ID),
    );

    expect(result.data.filter((role) => !role.system)).toEqual([]);
  });

  it('creates a custom role', async () => {
    const created = await new CreateOrganizationRoleHandler(
      roles,
      authorizationHolding(ALL_PERMISSIONS),
    ).execute(
      new CreateOrganizationRoleCommand(roleCommand('auditor', [PERMISSIONS.AUDIT_LOG_READ])),
    );

    expect(created.system).toBe(false);
    expect(created.permissions).toEqual([PERMISSIONS.AUDIT_LOG_READ]);
    expect(await roles.findByName(ORG_ID, 'auditor')).not.toBeNull();
  });

  it('refuses a duplicate role name with a conflict', async () => {
    const handler = new CreateOrganizationRoleHandler(roles, authorizationHolding(ALL_PERMISSIONS));
    await handler.execute(
      new CreateOrganizationRoleCommand(roleCommand('auditor', [PERMISSIONS.AUDIT_LOG_READ])),
    );

    const second = handler.execute(
      new CreateOrganizationRoleCommand(roleCommand('auditor', [PERMISSIONS.MEMBER_READ])),
    );

    await expect(second).rejects.toBeInstanceOf(DomainException);
    await expect(second).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('replaces the permissions of an existing role', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: ORG_ID,
        grantedToActor: ALL_PERMISSIONS,
        role: 'auditor',
        permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.MEMBER_READ],
      }),
    );

    const updated = await new UpdateOrganizationRoleHandler(
      roles,
      authorizationHolding(ALL_PERMISSIONS),
    ).execute(new UpdateOrganizationRoleCommand(roleCommand('auditor', [PERMISSIONS.FILE_READ])));

    expect(updated.permissions).toEqual([PERMISSIONS.FILE_READ]);
  });

  it('answers not_found when updating a role that does not exist', async () => {
    const execute = new UpdateOrganizationRoleHandler(
      roles,
      authorizationHolding(ALL_PERMISSIONS),
    ).execute(new UpdateOrganizationRoleCommand(roleCommand('ghost', [PERMISSIONS.FILE_READ])));

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('answers a retryable conflict when the role changed between the read and the write', async () => {
    const original = OrganizationRole.create({
      organizationId: ORG_ID,
      grantedToActor: ALL_PERMISSIONS,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
    });
    await roles.create(original);
    await roles.update(original.withPermissions([PERMISSIONS.MEMBER_READ], ALL_PERMISSIONS));
    const staleRead: OrganizationRoleRepositoryPort = {
      findAll: (organizationId) => roles.findAll(organizationId),
      findByName: async () => original,
      create: (role) => roles.create(role),
      update: (role) => roles.update(role),
      deleteUnlessHeld: (organizationId, role) => roles.deleteUnlessHeld(organizationId, role),
    };

    const execute = new UpdateOrganizationRoleHandler(
      staleRead,
      authorizationHolding(ALL_PERMISSIONS),
    ).execute(new UpdateOrganizationRoleCommand(roleCommand('auditor', [PERMISSIONS.FILE_READ])));

    await expect(execute).rejects.toBeInstanceOf(DomainException);
    await expect(execute).rejects.toMatchObject({
      kind: 'conflict',
      code: 'conflict',
      permanent: false,
    });
    expect((await roles.findByName(ORG_ID, 'auditor'))?.permissions).toEqual([
      PERMISSIONS.MEMBER_READ,
    ]);
  });

  it('deletes a role nobody holds', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: ORG_ID,
        grantedToActor: ALL_PERMISSIONS,
        role: 'auditor',
        permissions: [PERMISSIONS.AUDIT_LOG_READ],
      }),
    );

    await new DeleteOrganizationRoleHandler(roles).execute(
      new DeleteOrganizationRoleCommand(ORG_ID, 'auditor'),
    );

    expect(await roles.findByName(ORG_ID, 'auditor')).toBeNull();
  });

  it('refuses to delete a role a member still holds', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: ORG_ID,
        grantedToActor: ALL_PERMISSIONS,
        role: 'auditor',
        permissions: [PERMISSIONS.AUDIT_LOG_READ],
      }),
    );
    roles.setHolders(ORG_ID, 'auditor', 1);

    const execute = new DeleteOrganizationRoleHandler(roles).execute(
      new DeleteOrganizationRoleCommand(ORG_ID, 'auditor'),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'conflict' });
    expect(await roles.findByName(ORG_ID, 'auditor')).not.toBeNull();
  });

  it('answers not_found when deleting a role that does not exist', async () => {
    const execute = new DeleteOrganizationRoleHandler(roles).execute(
      new DeleteOrganizationRoleCommand(ORG_ID, 'ghost'),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('refuses to create a role granting a permission the actor does not hold', async () => {
    const handler = new CreateOrganizationRoleHandler(
      roles,
      authorizationHolding([PERMISSIONS.ROLE_CREATE, PERMISSIONS.AUDIT_LOG_READ]),
    );

    const execute = handler.execute(
      new CreateOrganizationRoleCommand(
        roleCommand('escalator', [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.ORGANIZATION_DELETE]),
      ),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await roles.findByName(ORG_ID, 'escalator')).toBeNull();
  });

  it('resolves the actor grant for the organization being edited', async () => {
    const authorization = authorizationHolding(ALL_PERMISSIONS);

    await new CreateOrganizationRoleHandler(roles, authorization).execute(
      new CreateOrganizationRoleCommand(roleCommand('auditor', [PERMISSIONS.AUDIT_LOG_READ])),
    );

    expect(authorization.permissionsFor).toHaveBeenCalledWith({
      type: 'user',
      userId: ACTOR_ID,
      organizationId: ORG_ID,
    });
  });

  it('refuses to widen an existing role beyond the actor grant', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: ORG_ID,
        grantedToActor: ALL_PERMISSIONS,
        role: 'auditor',
        permissions: [PERMISSIONS.AUDIT_LOG_READ],
      }),
    );
    const handler = new UpdateOrganizationRoleHandler(
      roles,
      authorizationHolding([PERMISSIONS.ROLE_UPDATE, PERMISSIONS.AUDIT_LOG_READ]),
    );

    const execute = handler.execute(
      new UpdateOrganizationRoleCommand(
        roleCommand('auditor', [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.MEMBER_REMOVE]),
      ),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await roles.findByName(ORG_ID, 'auditor'))?.permissions).toEqual([
      PERMISSIONS.AUDIT_LOG_READ,
    ]);
  });
});

describe('team handlers', () => {
  let teams: InMemoryTeamRepository;

  beforeEach(() => {
    teams = new InMemoryTeamRepository();
  });

  it('creates a team with no members yet', async () => {
    const created = await new CreateTeamHandler(teams).execute(
      new CreateTeamCommand(ORG_ID, 'Platform'),
    );

    expect(created.name).toBe('Platform');
    expect(created.memberCount).toBe(0);
  });

  it('lists teams scoped to the organization with a cursor', async () => {
    teams.seed(Team.create({ organizationId: ORG_ID, name: 'Platform' }), 3);
    teams.seed(Team.create({ organizationId: OTHER_ORG_ID, name: 'Outsider' }), 9);

    const result = await new ListTeamsHandler(teams).execute(new ListTeamsQuery(ORG_ID, 20));

    expect(result.data).toHaveLength(1);
    expect(result.data[0].memberCount).toBe(3);
    expect(result.lastCursor).not.toBeNull();
  });

  it('filters the team list by name', async () => {
    teams.seed(Team.create({ organizationId: ORG_ID, name: 'Platform' }));
    teams.seed(Team.create({ organizationId: ORG_ID, name: 'Design' }));

    const result = await new ListTeamsHandler(teams).execute(
      new ListTeamsQuery(ORG_ID, 20, { search: 'plat' }),
    );

    expect(result.data.map((team) => team.name)).toEqual(['Platform']);
  });

  it('rejects a malformed cursor as malformed input', async () => {
    const execute = new ListTeamsHandler(teams).execute(
      new ListTeamsQuery(ORG_ID, 20, { startingAfter: '!!!' }),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('renames a team and preserves its member count', async () => {
    const team = Team.create({ organizationId: ORG_ID, name: 'Platform' });
    teams.seed(team, 4);

    const updated = await new UpdateTeamHandler(teams).execute(
      new UpdateTeamCommand(ORG_ID, team.id, 'Infrastructure'),
    );

    expect(updated.name).toBe('Infrastructure');
    expect(updated.memberCount).toBe(4);
  });

  it('answers not_found when renaming a team of another organization', async () => {
    const team = Team.create({ organizationId: OTHER_ORG_ID, name: 'Outsider' });
    teams.seed(team);

    const execute = new UpdateTeamHandler(teams).execute(
      new UpdateTeamCommand(ORG_ID, team.id, 'Mine'),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('answers not_found when the team is deleted between the read and the write', async () => {
    const team = Team.create({ organizationId: ORG_ID, name: 'Platform' });
    teams.seed(team);
    const snapshot = await teams.findById(ORG_ID, team.id);
    await teams.delete(ORG_ID, team.id);
    const staleRead: TeamRepositoryPort = {
      findAllCursor: (options) => teams.findAllCursor(options),
      findById: async () => snapshot,
      create: (created) => teams.create(created),
      update: (renamed) => teams.update(renamed),
      delete: (organizationId, id) => teams.delete(organizationId, id),
    };

    const execute = new UpdateTeamHandler(staleRead).execute(
      new UpdateTeamCommand(ORG_ID, team.id, 'Core'),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('answers a retryable conflict when the team changed between the read and the write', async () => {
    const team = Team.create({ organizationId: ORG_ID, name: 'Platform' });
    teams.seed(team);
    const snapshot = await teams.findById(ORG_ID, team.id);
    await teams.update(team.renamedTo('Core'));
    const staleRead: TeamRepositoryPort = {
      findAllCursor: (options) => teams.findAllCursor(options),
      findById: async () => snapshot,
      create: (created) => teams.create(created),
      update: (renamed) => teams.update(renamed),
      delete: (organizationId, id) => teams.delete(organizationId, id),
    };

    const execute = new UpdateTeamHandler(staleRead).execute(
      new UpdateTeamCommand(ORG_ID, team.id, 'Infrastructure'),
    );

    await expect(execute).rejects.toBeInstanceOf(DomainException);
    await expect(execute).rejects.toMatchObject({
      kind: 'conflict',
      code: 'conflict',
      permanent: false,
    });
    expect((await teams.findById(ORG_ID, team.id))?.name).toBe('Core');
  });

  it('deletes a team and reports not_found on a second delete', async () => {
    const team = Team.create({ organizationId: ORG_ID, name: 'Platform' });
    teams.seed(team);
    const handler = new DeleteTeamHandler(teams);

    await handler.execute(new DeleteTeamCommand(ORG_ID, team.id));

    await expect(handler.execute(new DeleteTeamCommand(ORG_ID, team.id))).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('honours startingAfter with an id tiebreak on same-timestamp teams', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const lower = Team.reconstitute({
      id: '019dd1a5-9235-70db-8d57-54ef90700010',
      organizationId: ORG_ID,
      name: 'Alpha',
      createdAt,
      updatedAt: null,
      version: 0,
    });
    const higher = Team.reconstitute({
      id: '019dd1a5-9235-70db-8d57-54ef90700020',
      organizationId: ORG_ID,
      name: 'Beta',
      createdAt,
      updatedAt: null,
      version: 0,
    });
    teams.seed(lower);
    teams.seed(higher);

    const page1 = await new ListTeamsHandler(teams).execute(new ListTeamsQuery(ORG_ID, 1));
    expect(page1.data.map((team) => team.name)).toEqual(['Beta']);
    expect(page1.hasMore).toBe(true);

    const page2 = await new ListTeamsHandler(teams).execute(
      new ListTeamsQuery(ORG_ID, 1, { startingAfter: page1.lastCursor ?? undefined }),
    );
    expect(page2.data.map((team) => team.name)).toEqual(['Alpha']);
    expect(page2.hasMore).toBe(false);
  });
});

describe('invitation handlers', () => {
  let invitations: InMemoryInvitationRepository;

  function seedInvitation(
    status: 'pending' | 'accepted',
    organizationId = ORG_ID,
    expiresAt = new Date(Date.now() + ONE_DAY_MS),
  ) {
    const record = {
      id: generateId(),
      organizationId,
      email: 'invitee@example.com',
      role: 'member',
      teamId: null,
      status,
      expiresAt,
      inviterId: INVITER_ID,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    } as const;
    invitations.seed(record);
    return record;
  }

  beforeEach(() => {
    invitations = new InMemoryInvitationRepository();
  });

  it('lists invitations of the organization only', async () => {
    seedInvitation('pending');
    seedInvitation('pending', OTHER_ORG_ID);

    const result = await new ListInvitationsHandler(invitations).execute(
      new ListInvitationsQuery(ORG_ID, 20),
    );

    expect(result.data).toHaveLength(1);
  });

  it('filters invitations by status', async () => {
    seedInvitation('pending');
    seedInvitation('accepted');

    const result = await new ListInvitationsHandler(invitations).execute(
      new ListInvitationsQuery(ORG_ID, 20, { status: 'accepted' }),
    );

    expect(result.data.map((invitation) => invitation.status)).toEqual(['accepted']);
  });

  it('hides an expired invitation behind the pending filter', async () => {
    seedInvitation('pending', ORG_ID, new Date(Date.now() - ONE_DAY_MS));
    const live = seedInvitation('pending');

    const result = await new ListInvitationsHandler(invitations).execute(
      new ListInvitationsQuery(ORG_ID, 20, { status: 'pending' }),
    );

    expect(result.data.map((invitation) => invitation.id)).toEqual([live.id]);
  });

  it('cancels a pending invitation', async () => {
    const invitation = seedInvitation('pending');

    await new CancelInvitationHandler(invitations).execute(
      new CancelInvitationCommand(ORG_ID, invitation.id),
    );

    expect((await invitations.findById(ORG_ID, invitation.id))?.status).toBe('canceled');
  });

  it('reports a conflict when the invitation is no longer pending', async () => {
    const invitation = seedInvitation('accepted');

    const execute = new CancelInvitationHandler(invitations).execute(
      new CancelInvitationCommand(ORG_ID, invitation.id),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('reports not_found for an unknown invitation', async () => {
    const execute = new CancelInvitationHandler(invitations).execute(
      new CancelInvitationCommand(ORG_ID, generateId()),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('honours startingAfter with an id tiebreak on same-timestamp invitations', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const base = {
      organizationId: ORG_ID,
      role: 'member',
      teamId: null,
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + ONE_DAY_MS),
      inviterId: INVITER_ID,
      createdAt,
    };
    const lower = { ...base, id: '019dd1a5-9235-70db-8d57-54ef90700010', email: 'a@test.com' };
    const higher = { ...base, id: '019dd1a5-9235-70db-8d57-54ef90700020', email: 'b@test.com' };
    invitations.seed(lower);
    invitations.seed(higher);

    const page1 = await new ListInvitationsHandler(invitations).execute(
      new ListInvitationsQuery(ORG_ID, 1),
    );
    expect(page1.data.map((invitation) => invitation.email)).toEqual(['b@test.com']);
    expect(page1.hasMore).toBe(true);

    const page2 = await new ListInvitationsHandler(invitations).execute(
      new ListInvitationsQuery(ORG_ID, 1, { startingAfter: page1.lastCursor ?? undefined }),
    );
    expect(page2.data.map((invitation) => invitation.email)).toEqual(['a@test.com']);
    expect(page2.hasMore).toBe(false);
  });
});

describe('GetCurrentOrganizationHandler', () => {
  it('returns the summary of the active organization', async () => {
    const organizations = new InMemoryOrganizationRepository();
    organizations.seed({
      id: ORG_ID,
      name: 'Acme',
      slug: 'acme',
      logo: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      memberCount: 4,
      teamCount: 2,
      pendingInvitationCount: 1,
    });

    const result = await new GetCurrentOrganizationHandler(organizations).execute(
      new GetCurrentOrganizationQuery(ORG_ID),
    );

    expect(result).toMatchObject({ id: ORG_ID, memberCount: 4, pendingInvitationCount: 1 });
  });

  it('answers not_found when the organization is gone', async () => {
    const execute = new GetCurrentOrganizationHandler(new InMemoryOrganizationRepository()).execute(
      new GetCurrentOrganizationQuery(ORG_ID),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });
});
