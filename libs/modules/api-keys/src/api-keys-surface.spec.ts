import { describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { PERMISSIONS, generateId } from '@nestjs-fastify-nx/shared';
import { ApiKey } from './domain/entities/api-key.entity';
import { PrismaApiKeyRepository } from './infrastructure/repositories/prisma-api-key.repository';
import { ApiKeysController } from './presentation/controllers/api-keys.controller';
import { CreateApiKeyDto, ListApiKeysFilterDto } from './presentation/dto/api-key.dto';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91700001';

const SESSION: AuthenticatedSession = {
  userId: '019dd1a5-9235-70db-8d57-54ef91700002',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's-1',
  sessionToken: 't-1',
  organizationId: ORG_ID,
};

function prismaDouble(methods: Record<string, unknown>): PrismaService {
  const db = { apiKey: methods };
  return { db, readTarget: () => db, writeTarget: () => db } as unknown as PrismaService;
}

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: generateId(),
    organizationId: ORG_ID,
    name: 'CI bot',
    prefix: 'sk_abc12345',
    keyHash: 'a'.repeat(64),
    scopes: [PERMISSIONS.FILE_READ],
    createdById: SESSION.userId,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaApiKeyRepository', () => {
  it('scopes the listing to the organization and hides revoked keys by default', async () => {
    const findMany = vi.fn().mockResolvedValue([keyRow()]);
    const repository = new PrismaApiKeyRepository(prismaDouble({ findMany }));

    await repository.findAllCursor({ organizationId: ORG_ID, limit: 10, includeRevoked: false });

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG_ID,
      revokedAt: null,
    });
  });

  it('includes revoked keys when asked', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaApiKeyRepository(prismaDouble({ findMany }));

    await repository.findAllCursor({ organizationId: ORG_ID, limit: 10, includeRevoked: true });

    expect(findMany.mock.calls[0][0].where.revokedAt).toBeUndefined();
  });

  it('adds a keyset predicate for a cursor', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaApiKeyRepository(prismaDouble({ findMany }));
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const id = generateId();

    await repository.findAllCursor({
      organizationId: ORG_ID,
      limit: 10,
      includeRevoked: false,
      startingAfter: { createdAt, id },
    });

    expect(findMany.mock.calls[0][0].where.AND[0].OR).toEqual([
      { createdAt: { lt: createdAt } },
      { AND: [{ createdAt }, { id: { lt: id } }] },
    ]);
  });

  it('reports hasMore by over-fetching one row', async () => {
    const findMany = vi.fn().mockResolvedValue([keyRow(), keyRow(), keyRow()]);
    const repository = new PrismaApiKeyRepository(prismaDouble({ findMany }));

    const result = await repository.findAllCursor({
      organizationId: ORG_ID,
      limit: 2,
      includeRevoked: false,
    });

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('persists the digest, never a raw key', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const repository = new PrismaApiKeyRepository(prismaDouble({ create }));
    const { entity, raw } = ApiKey.issue({
      organizationId: ORG_ID,
      name: 'CI bot',
      scopes: [PERMISSIONS.FILE_READ],
      createdById: SESSION.userId,
      grantedToIssuer: [PERMISSIONS.FILE_READ],
    });

    await repository.create(entity);

    const persisted = create.mock.calls[0][0].data;
    expect(persisted.keyHash).toBe(entity.keyHash);
    expect(JSON.stringify(persisted)).not.toContain(raw);
  });

  it('revokes only a key that is still live', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaApiKeyRepository(prismaDouble({ updateMany }));
    const id = generateId();

    expect(await repository.revoke(ORG_ID, id, new Date())).toBe(false);
    expect(updateMany.mock.calls[0][0].where).toEqual({
      id,
      organizationId: ORG_ID,
      revokedAt: null,
    });
  });

  it('scopes the existence check to the organization', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaApiKeyRepository(prismaDouble({ findFirst }));

    expect(await repository.exists(ORG_ID, generateId())).toBe(false);
  });
});

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
