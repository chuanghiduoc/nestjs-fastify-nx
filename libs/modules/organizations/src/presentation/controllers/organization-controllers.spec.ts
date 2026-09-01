import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { PERMISSIONS, generateId } from '@nestjs-fastify-nx/shared';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { OrganizationRolesController } from './organization-roles.controller';
import { TeamsController } from './teams.controller';
import { InvitationsController } from './invitations.controller';
import { OrganizationsController } from './organizations.controller';
import {
  CreateOrganizationRoleDto,
  CreateTeamDto,
  ListInvitationsFilterDto,
  ListTeamsFilterDto,
  UpdateOrganizationRoleDto,
  UpdateTeamDto,
} from '../dto/organization-role.dto';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91500001';

const SESSION: AuthenticatedSession = {
  userId: '019dd1a5-9235-70db-8d57-54ef91500002',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's-1',
  sessionToken: 't-1',
  organizationId: ORG_ID,
};

const EMPTY_CURSOR_PAGE = { data: [], hasMore: false, lastCursor: null };

describe('OrganizationRolesController', () => {
  let queryBus: { execute: ReturnType<typeof vi.fn> };
  let commandBus: { execute: ReturnType<typeof vi.fn> };
  let controller: OrganizationRolesController;

  beforeEach(() => {
    queryBus = { execute: vi.fn() };
    commandBus = { execute: vi.fn() };
    controller = new OrganizationRolesController(
      queryBus as unknown as QueryBus,
      commandBus as unknown as CommandBus,
    );
  });

  it('returns the role list in a flat list envelope', async () => {
    queryBus.execute.mockResolvedValue({
      data: [
        {
          id: null,
          role: 'owner',
          system: true,
          permissions: [],
          createdAt: null,
          updatedAt: null,
        },
      ],
    });

    const response = await controller.list(SESSION);

    expect(response.object).toBe('list');
    expect(response.url).toBe('/api/v1/organizations/current/roles');
    expect(response.data).toHaveLength(1);
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
    );
  });

  it('dispatches a create command carrying the caller organization', async () => {
    commandBus.execute.mockResolvedValue({});
    const dto = Object.assign(new CreateOrganizationRoleDto(), {
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
    });

    await controller.create(SESSION, dto);

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        role: 'auditor',
        permissions: [PERMISSIONS.AUDIT_LOG_READ],
      }),
    );
  });

  it('dispatches an update command for the named role', async () => {
    commandBus.execute.mockResolvedValue({});
    const dto = Object.assign(new UpdateOrganizationRoleDto(), {
      permissions: [PERMISSIONS.FILE_READ],
    });

    await controller.update(SESSION, 'auditor', dto);

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, role: 'auditor' }),
    );
  });

  it('dispatches a delete command for the named role', async () => {
    commandBus.execute.mockResolvedValue(undefined);

    await controller.remove(SESSION, 'auditor');

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, role: 'auditor' }),
    );
  });
});

describe('TeamsController', () => {
  let queryBus: { execute: ReturnType<typeof vi.fn> };
  let commandBus: { execute: ReturnType<typeof vi.fn> };
  let controller: TeamsController;

  beforeEach(() => {
    queryBus = { execute: vi.fn() };
    commandBus = { execute: vi.fn() };
    controller = new TeamsController(
      queryBus as unknown as QueryBus,
      commandBus as unknown as CommandBus,
    );
  });

  it('builds the list query from the filter DTO and returns a cursor envelope', async () => {
    queryBus.execute.mockResolvedValue(EMPTY_CURSOR_PAGE);
    const filter = Object.assign(new ListTeamsFilterDto(), {
      limit: 15,
      startingAfter: 'cursor',
      search: 'plat',
    });

    const response = await controller.list(SESSION, filter);

    expect(response.url).toBe('/api/v1/organizations/current/teams');
    // Left undefined so it is dropped from the JSON body: COUNT(*) is not paid on a growth table.
    expect(response.totalCount).toBeUndefined();
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        limit: 15,
        startingAfter: 'cursor',
        search: 'plat',
      }),
    );
  });

  it('dispatches create, update and delete commands scoped to the organization', async () => {
    commandBus.execute.mockResolvedValue({});
    const id = generateId();

    await controller.create(SESSION, Object.assign(new CreateTeamDto(), { name: 'Platform' }));
    await controller.update(SESSION, id, Object.assign(new UpdateTeamDto(), { name: 'Infra' }));
    await controller.remove(SESSION, id);

    expect(commandBus.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ organizationId: ORG_ID, name: 'Platform' }),
    );
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ organizationId: ORG_ID, id, name: 'Infra' }),
    );
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ organizationId: ORG_ID, id }),
    );
  });
});

describe('InvitationsController', () => {
  let queryBus: { execute: ReturnType<typeof vi.fn> };
  let commandBus: { execute: ReturnType<typeof vi.fn> };
  let controller: InvitationsController;

  beforeEach(() => {
    queryBus = { execute: vi.fn() };
    commandBus = { execute: vi.fn() };
    controller = new InvitationsController(
      queryBus as unknown as QueryBus,
      commandBus as unknown as CommandBus,
    );
  });

  it('passes the status and email filters through', async () => {
    queryBus.execute.mockResolvedValue(EMPTY_CURSOR_PAGE);
    const filter = Object.assign(new ListInvitationsFilterDto(), {
      limit: 20,
      status: 'pending' as const,
      email: 'invitee@example.com',
    });

    const response = await controller.list(SESSION, filter);

    expect(response.url).toBe('/api/v1/organizations/current/invitations');
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', email: 'invitee@example.com' }),
    );
  });

  it('dispatches a cancel command for the invitation', async () => {
    commandBus.execute.mockResolvedValue(undefined);
    const id = generateId();

    await controller.cancel(SESSION, id);

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, id }),
    );
  });
});

describe('OrganizationsController', () => {
  it('reads the active organization of the session', async () => {
    const queryBus = { execute: vi.fn().mockResolvedValue({ id: ORG_ID }) };
    const controller = new OrganizationsController(queryBus as unknown as QueryBus);

    const result = await controller.current(SESSION);

    expect(result).toEqual({ id: ORG_ID });
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
    );
  });

  it('refuses when the session has no active organization', async () => {
    const queryBus = { execute: vi.fn() };
    const controller = new OrganizationsController(queryBus as unknown as QueryBus);

    expect(() => controller.current({ ...SESSION, organizationId: undefined })).toThrow();
    expect(queryBus.execute).not.toHaveBeenCalled();
  });
});
