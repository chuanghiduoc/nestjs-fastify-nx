import { describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Prisma, type PrismaService } from '@nestjs-fastify-nx/infra-database';
import { CursorPaginationDto } from '@nestjs-fastify-nx/contracts';
import type { AuthenticatedApiKey, AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { PERMISSIONS, generateId } from '@nestjs-fastify-nx/shared';
import { FeatureFlag } from './domain/entities/feature-flag.entity';
import { PrismaFeatureFlagRepository } from './infrastructure/repositories/prisma-feature-flag.repository';
import { FeatureFlagsController } from './presentation/controllers/feature-flags.controller';
import { CreateFeatureFlagDto, UpdateFeatureFlagDto } from './presentation/dto/feature-flag.dto';

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
  sessionToken: 't-1',
  organizationId: ORG_ID,
};

const API_KEY: AuthenticatedApiKey = {
  apiKeyId: MACHINE_PRINCIPAL_ID,
  organizationId: MACHINE_ORG_ID,
  scopes: [PERMISSIONS.FEATURE_FLAG_READ],
};

function prismaDouble(methods: Record<string, unknown>): PrismaService {
  const db = { featureFlag: methods };
  return { db, readTarget: () => db, writeTarget: () => db } as unknown as PrismaService;
}

function flagRow(overrides: Record<string, unknown> = {}) {
  return {
    id: generateId(),
    organizationId: ORG_ID,
    key: 'checkout.new-flow',
    description: null,
    enabled: true,
    rolloutPercentage: 100,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaFeatureFlagRepository', () => {
  it('scopes the listing to the organization', async () => {
    const findMany = vi.fn().mockResolvedValue([flagRow()]);
    const repository = new PrismaFeatureFlagRepository(prismaDouble({ findMany }));

    await repository.findAllCursor({ organizationId: ORG_ID, limit: 10 });

    expect(findMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG_ID });
  });

  it('adds a keyset predicate for a cursor and reports hasMore', async () => {
    const findMany = vi.fn().mockResolvedValue([flagRow(), flagRow(), flagRow()]);
    const repository = new PrismaFeatureFlagRepository(prismaDouble({ findMany }));
    const createdAt = new Date('2026-08-01T00:00:00.000Z');

    const result = await repository.findAllCursor({
      organizationId: ORG_ID,
      limit: 2,
      startingAfter: { createdAt, id: generateId() },
    });

    expect(findMany.mock.calls[0][0].where.AND[0].OR).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('returns every flag of the organization for evaluation', async () => {
    const findMany = vi.fn().mockResolvedValue([flagRow(), flagRow({ key: 'other.flag' })]);
    const repository = new PrismaFeatureFlagRepository(prismaDouble({ findMany }));

    expect(await repository.findAll(ORG_ID)).toHaveLength(2);
  });

  it('translates a duplicate key into a domain conflict', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '7.0.0',
      meta: {},
    });
    const repository = new PrismaFeatureFlagRepository(
      prismaDouble({ create: vi.fn().mockRejectedValue(duplicate) }),
    );

    await expect(
      repository.create(FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' })),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('propagates an unrecognised failure', async () => {
    const failure = new Error('connection lost');
    const repository = new PrismaFeatureFlagRepository(
      prismaDouble({ create: vi.fn().mockRejectedValue(failure) }),
    );

    await expect(
      repository.create(FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow' })),
    ).rejects.toBe(failure);
  });

  it('scopes findById and delete to the organization', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaFeatureFlagRepository(prismaDouble({ findFirst, deleteMany }));
    const id = generateId();

    expect(await repository.findById(ORG_ID, id)).toBeNull();
    expect(await repository.delete(ORG_ID, id)).toBe(false);
    expect(findFirst.mock.calls[0][0].where).toEqual({ id, organizationId: ORG_ID });
    expect(deleteMany.mock.calls[0][0].where).toEqual({ id, organizationId: ORG_ID });
  });
});

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

  // An API key carries its own tenant, so a machine caller must be scoped by the key, never by an
  // active organization it does not have.
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
