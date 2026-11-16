import { describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { PERMISSIONS, generateId } from '@nestjs-fastify-nx/shared';
import { ApiKeysController } from './api-keys.controller';
import { CreateApiKeyDto, ListApiKeysFilterDto } from '../dto/api-keys.dto';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91700001';

const SESSION: AuthenticatedSession = {
  userId: '019dd1a5-9235-70db-8d57-54ef91700002',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's-1',
  organizationId: ORG_ID,
};

describe('ApiKeysController', () => {
  function build() {
    const queryBus = { execute: vi.fn() };
    const commandBus = { execute: vi.fn() };
    return {
      queryBus,
      commandBus,
      controller: new ApiKeysController(
        queryBus as unknown as QueryBus,
        commandBus as unknown as CommandBus,
      ),
    };
  }

  it('returns a cursor envelope pointed at the api-keys path', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [], hasMore: false, lastCursor: null });
    const filter = Object.assign(new ListApiKeysFilterDto(), {
      limit: 5,
      includeRevoked: true,
    });

    const response = await controller.list(SESSION, filter);

    expect(response.url).toBe('/api/v1/api-keys');
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, includeRevoked: true }),
    );
  });

  it('dispatches a create command carrying the caller identity', async () => {
    const { commandBus, controller } = build();
    commandBus.execute.mockResolvedValue({});
    const dto = Object.assign(new CreateApiKeyDto(), {
      name: 'CI bot',
      scopes: [PERMISSIONS.FILE_READ],
    });

    await controller.create(SESSION, dto);

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, userId: SESSION.userId, name: 'CI bot' }),
    );
  });

  it('dispatches a revoke command for the key', async () => {
    const { commandBus, controller } = build();
    commandBus.execute.mockResolvedValue(undefined);
    const id = generateId();

    await controller.revoke(SESSION, id);

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, id }),
    );
  });

  it('refuses when the session has no active organization', async () => {
    const { controller, queryBus } = build();

    await expect(
      controller.list({ ...SESSION, organizationId: undefined }, new ListApiKeysFilterDto()),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(queryBus.execute).not.toHaveBeenCalled();
  });
});
