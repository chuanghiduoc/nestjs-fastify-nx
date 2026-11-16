import { describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CursorPaginationDto } from '@nestjs-fastify-nx/contracts';
import type { AuthenticatedApiKey, AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { PERMISSIONS, generateId } from '@nestjs-fastify-nx/shared';
import { FeatureFlagsController } from './feature-flags.controller';
import { CreateFeatureFlagDto, UpdateFeatureFlagDto } from '../dto/feature-flags.dto';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91900001';
const MACHINE_ORG_ID = '019dd1a5-9235-70db-8d57-54ef91900004';
const MACHINE_PRINCIPAL_ID = '019dd1a5-9235-70db-8d57-54ef91900003';

const SESSION: AuthenticatedSession = {
  userId: '019dd1a5-9235-70db-8d57-54ef91900002',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's-1',
  organizationId: ORG_ID,
};

const API_KEY: AuthenticatedApiKey = {
  apiKeyId: MACHINE_PRINCIPAL_ID,
  organizationId: MACHINE_ORG_ID,
  scopes: [PERMISSIONS.FEATURE_FLAG_READ],
};

describe('FeatureFlagsController', () => {
  function build() {
    const queryBus = { execute: vi.fn() };
    const commandBus = { execute: vi.fn() };
    return {
      queryBus,
      commandBus,
      controller: new FeatureFlagsController(
        queryBus as unknown as QueryBus,
        commandBus as unknown as CommandBus,
      ),
    };
  }

  it('lists flags for a session caller', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [], hasMore: false, lastCursor: null });

    const response = await controller.list(SESSION, undefined, new CursorPaginationDto());

    expect(response.url).toBe('/api/v1/feature-flags');
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
    );
  });

  it('scopes a machine caller by the organization the key was issued for', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [], hasMore: false, lastCursor: null });

    await controller.list(undefined, API_KEY, new CursorPaginationDto());

    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: MACHINE_ORG_ID }),
    );
  });

  it('buckets a session caller by their user id and a machine caller by the key id', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ flags: {} });

    await controller.evaluate(SESSION, undefined);
    await controller.evaluate(undefined, API_KEY);

    expect(queryBus.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ organizationId: ORG_ID, subjectId: SESSION.userId }),
    );
    expect(queryBus.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ organizationId: MACHINE_ORG_ID, subjectId: API_KEY.apiKeyId }),
    );
  });

  it('dispatches create, update and delete commands', async () => {
    const { commandBus, controller } = build();
    commandBus.execute.mockResolvedValue({});
    const id = generateId();

    await controller.create(
      SESSION,
      Object.assign(new CreateFeatureFlagDto(), { key: 'checkout.new-flow', enabled: true }),
    );
    await controller.update(
      SESSION,
      id,
      Object.assign(new UpdateFeatureFlagDto(), { rolloutPercentage: 25 }),
    );
    await controller.remove(SESSION, id);

    expect(commandBus.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ organizationId: ORG_ID, key: 'checkout.new-flow' }),
    );
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ organizationId: ORG_ID, id, rolloutPercentage: 25 }),
    );
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ organizationId: ORG_ID, id }),
    );
  });
});
