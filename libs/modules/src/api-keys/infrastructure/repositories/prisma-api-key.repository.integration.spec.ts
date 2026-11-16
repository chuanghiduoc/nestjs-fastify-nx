import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { ApiKey, type ApiKeyProps } from '../../domain/entities/api-key.entity';
import { PrismaApiKeyRepository } from './prisma-api-key.repository';

const ORG_A = '019dd1a5-9235-70db-8d57-540700000001';
const ORG_B = '019dd1a5-9235-70db-8d57-540700000002';
const USER_ID = '019dd1a5-9235-70db-8d57-540700000003';

const CREATED_AT = new Date('2026-08-01T00:00:00.000Z');

function apiKey(id: string, overrides: Partial<ApiKeyProps> = {}): ApiKey {
  const createdAt = overrides.createdAt ?? CREATED_AT;
  return ApiKey.reconstitute({
    id,
    organizationId: ORG_A,
    name: 'CI bot',
    prefix: `sk_${id.slice(-8)}`,
    keyHash: id.replaceAll('-', '').padEnd(64, '0'),
    scopes: [PERMISSIONS.FILE_READ],
    createdById: USER_ID,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });
}

describe('PrismaApiKeyRepository (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let repository: PrismaApiKeyRepository;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();
    repository = new PrismaApiKeyRepository(prisma);
    cleaner = new DatabaseCleaner(prisma.db);
  }, 90_000);

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    await prisma.db.user.create({
      data: { id: USER_ID, name: 'Owner', email: 'owner@api-keys.local' },
    });
    await prisma.db.organization.createMany({
      data: [
        { id: ORG_A, name: 'Keys Org', slug: 'keys-org' },
        { id: ORG_B, name: 'Other Keys', slug: 'other-keys' },
      ],
    });
  });

  it('persists only the digest of an issued key', async () => {
    const { entity, raw } = ApiKey.issue({
      organizationId: ORG_A,
      name: 'CI bot',
      scopes: [PERMISSIONS.FILE_READ],
      createdById: USER_ID,
      grantedToIssuer: [PERMISSIONS.FILE_READ],
    });

    await repository.create(entity);

    const row = await prisma.db.apiKey.findUniqueOrThrow({ where: { id: entity.id } });
    expect(row.keyHash).toBe(entity.keyHash);
    expect(row.prefix).toBe(entity.prefix);
    expect(row.scopes).toEqual([PERMISSIONS.FILE_READ]);
    expect(JSON.stringify(row)).not.toContain(raw);
  });

  it('hides revoked keys unless includeRevoked is true', async () => {
    const liveId = '019dd1a5-9235-70db-8d57-54070000000a';
    const revokedId = '019dd1a5-9235-70db-8d57-54070000000b';
    await repository.create(apiKey(liveId));
    await repository.create(apiKey(revokedId));
    await repository.revoke(ORG_A, revokedId, new Date());

    const live = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 10,
      includeRevoked: false,
    });
    const all = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 10,
      includeRevoked: true,
    });

    expect(live.items.map((key) => key.id)).toEqual([liveId]);
    expect(all.items.map((key) => key.id).sort()).toEqual([liveId, revokedId].sort());
  });

  it('resumes after the keyset cursor and reports hasMore', async () => {
    const olderId = '019dd1a5-9235-70db-8d57-540700000011';
    const newerLowId = '019dd1a5-9235-70db-8d57-540700000012';
    const newerHighId = '019dd1a5-9235-70db-8d57-540700000013';
    const newerTime = new Date('2026-08-02T00:00:00.000Z');
    await repository.create(apiKey(olderId, { createdAt: CREATED_AT }));
    await repository.create(apiKey(newerLowId, { createdAt: newerTime }));
    await repository.create(apiKey(newerHighId, { createdAt: newerTime }));

    const first = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 2,
      includeRevoked: false,
    });

    expect(first.items.map((key) => key.id)).toEqual([newerHighId, newerLowId]);
    expect(first.hasMore).toBe(true);

    const last = first.items[first.items.length - 1];
    const second = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 2,
      includeRevoked: false,
      startingAfter: { createdAt: last.createdAt, id: last.id },
    });

    expect(second.items.map((key) => key.id)).toEqual([olderId]);
    expect(second.hasMore).toBe(false);
  });

  it('scopes the existence check to the organization', async () => {
    const id = '019dd1a5-9235-70db-8d57-540700000021';
    await repository.create(apiKey(id));

    expect(await repository.exists(ORG_A, id)).toBe(true);
    expect(await repository.exists(ORG_B, id)).toBe(false);
  });

  it('keeps one organization out of another listing and revocation', async () => {
    const foreignId = '019dd1a5-9235-70db-8d57-540700000031';
    await repository.create(apiKey(foreignId, { organizationId: ORG_B }));

    const listing = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 10,
      includeRevoked: true,
    });

    expect(listing.items).toEqual([]);
    expect(await repository.revoke(ORG_A, foreignId, new Date())).toBe(false);
    expect(await repository.revoke(ORG_B, foreignId, new Date())).toBe(true);
    expect(await repository.revoke(ORG_B, foreignId, new Date())).toBe(false);
  });
}, 90_000);
