import { beforeEach, describe, expect, it } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { PERMISSIONS, SYSTEM_ROLES, generateId } from '@nestjs-fastify-nx/shared';
import { OrganizationRole } from '../domain/entities/organization-role.entity';
import { Team } from '../domain/entities/team.entity';
import {
  InMemoryInvitationRepository,
  InMemoryOrganizationRepository,
  InMemoryOrganizationRoleRepository,
  InMemoryTeamRepository,
} from '../testing/in-memory-repositories';
import { ListOrganizationRolesHandler } from './queries/list-organization-roles/list-organization-roles.handler';
import { ListOrganizationRolesQuery } from './queries/list-organization-roles/list-organization-roles.query';
import { CreateOrganizationRoleHandler } from './commands/create-organization-role/create-organization-role.handler';
import { CreateOrganizationRoleCommand } from './commands/create-organization-role/create-organization-role.command';
import { UpdateOrganizationRoleHandler } from './commands/update-organization-role/update-organization-role.handler';
import { UpdateOrganizationRoleCommand } from './commands/update-organization-role/update-organization-role.command';
import { DeleteOrganizationRoleHandler } from './commands/delete-organization-role/delete-organization-role.handler';
import { DeleteOrganizationRoleCommand } from './commands/delete-organization-role/delete-organization-role.command';
import { ListTeamsHandler } from './queries/list-teams/list-teams.handler';
import { ListTeamsQuery } from './queries/list-teams/list-teams.query';
import { CreateTeamHandler } from './commands/create-team/create-team.handler';
import { CreateTeamCommand } from './commands/create-team/create-team.command';
import { UpdateTeamHandler } from './commands/update-team/update-team.handler';
import { UpdateTeamCommand } from './commands/update-team/update-team.command';
import { DeleteTeamHandler } from './commands/delete-team/delete-team.handler';
import { DeleteTeamCommand } from './commands/delete-team/delete-team.command';
import { ListInvitationsHandler } from './queries/list-invitations/list-invitations.handler';
import { ListInvitationsQuery } from './queries/list-invitations/list-invitations.query';
import { CancelInvitationHandler } from './commands/cancel-invitation/cancel-invitation.handler';
import { CancelInvitationCommand } from './commands/cancel-invitation/cancel-invitation.command';
import { GetCurrentOrganizationHandler } from './queries/get-current-organization/get-current-organization.handler';
import { GetCurrentOrganizationQuery } from './queries/get-current-organization/get-current-organization.query';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90700001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef90700002';
const INVITER_ID = '019dd1a5-9235-70db-8d57-54ef90700003';

describe('organization role handlers', () => {
  let roles: InMemoryOrganizationRoleRepository;

  beforeEach(() => {
    roles = new InMemoryOrganizationRoleRepository();
  });

  it('lists the system roles alongside the tenant-defined ones', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: ORG_ID,
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
    const created = await new CreateOrganizationRoleHandler(roles).execute(
      new CreateOrganizationRoleCommand(ORG_ID, 'auditor', [PERMISSIONS.AUDIT_LOG_READ]),
    );

    expect(created.system).toBe(false);
    expect(created.permissions).toEqual([PERMISSIONS.AUDIT_LOG_READ]);
    expect(await roles.findByName(ORG_ID, 'auditor')).not.toBeNull();
  });

  it('refuses a duplicate role name with a conflict', async () => {
    const handler = new CreateOrganizationRoleHandler(roles);
    await handler.execute(
      new CreateOrganizationRoleCommand(ORG_ID, 'auditor', [PERMISSIONS.AUDIT_LOG_READ]),
    );

    const second = handler.execute(
      new CreateOrganizationRoleCommand(ORG_ID, 'auditor', [PERMISSIONS.MEMBER_READ]),
    );

    await expect(second).rejects.toBeInstanceOf(DomainException);
    await expect(second).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('replaces the permissions of an existing role', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: ORG_ID,
        role: 'auditor',
        permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.MEMBER_READ],
      }),
    );

    const updated = await new UpdateOrganizationRoleHandler(roles).execute(
      new UpdateOrganizationRoleCommand(ORG_ID, 'auditor', [PERMISSIONS.FILE_READ]),
    );

    expect(updated.permissions).toEqual([PERMISSIONS.FILE_READ]);
  });

  it('answers not_found when updating a role that does not exist', async () => {
    const execute = new UpdateOrganizationRoleHandler(roles).execute(
      new UpdateOrganizationRoleCommand(ORG_ID, 'ghost', [PERMISSIONS.FILE_READ]),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('deletes a role nobody holds', async () => {
    await roles.create(
      OrganizationRole.create({
        organizationId: ORG_ID,
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

  it('deletes a team and reports not_found on a second delete', async () => {
    const team = Team.create({ organizationId: ORG_ID, name: 'Platform' });
    teams.seed(team);
    const handler = new DeleteTeamHandler(teams);

    await handler.execute(new DeleteTeamCommand(ORG_ID, team.id));

    await expect(handler.execute(new DeleteTeamCommand(ORG_ID, team.id))).rejects.toMatchObject({
      kind: 'not_found',
    });
  });
});

describe('invitation handlers', () => {
  let invitations: InMemoryInvitationRepository;

  function seedInvitation(status: 'pending' | 'accepted', organizationId = ORG_ID) {
    const record = {
      id: generateId(),
      organizationId,
      email: 'invitee@example.com',
      role: 'member',
      teamId: null,
      status,
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
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
