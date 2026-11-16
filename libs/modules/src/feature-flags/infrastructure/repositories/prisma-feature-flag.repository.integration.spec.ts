import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { FeatureFlag } from '../../domain/entities/feature-flag.entity';
import { PrismaFeatureFlagRepository } from './prisma-feature-flag.repository';

const ORG_ID = '019dd1a5-9235-70db-8d57-540400000001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-540400000002';

function flag(id: string, key: string, organizationId = ORG_ID): FeatureFlag {
  return FeatureFlag.create({
    id,
    organizationId,
    key,
    description: 'before',
    enabled: false,
    rolloutPercentage: 40,
  });
}

describe('PrismaFeatureFlagRepository (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let repository: PrismaFeatureFlagRepository;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();
    repository = new PrismaFeatureFlagRepository(prisma);
    cleaner = new DatabaseCleaner(prisma.db);
  }, 90_000);

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    await prisma.db.organization.createMany({
      data: [
        { id: ORG_ID, name: 'Flags Org', slug: 'flags-org' },
        { id: OTHER_ORG_ID, name: 'Other Flags', slug: 'flags-other' },
      ],
    });
  });

  it('translates a duplicate key into a domain conflict', async () => {
    await repository.create(flag('019dd1a5-9235-70db-8d57-54040000000a', 'checkout.new-flow'));

    await expect(
      repository.create(flag('019dd1a5-9235-70db-8d57-54040000000b', 'checkout.new-flow')),
    ).rejects.toMatchObject({ code: 'feature_flag_key_taken' });
  });

  it('scopes reads and deletes to the organization', async () => {
    const id = '019dd1a5-9235-70db-8d57-54040000000c';
    await repository.create(flag(id, 'mine.flag'));
    await repository.create(
      flag('019dd1a5-9235-70db-8d57-54040000000d', 'theirs.flag', OTHER_ORG_ID),
    );

    expect(await repository.findById(ORG_ID, id)).not.toBeNull();
    expect(await repository.findById(OTHER_ORG_ID, id)).toBeNull();
    expect(await repository.findAll(ORG_ID)).toHaveLength(1);
    expect(await repository.delete(OTHER_ORG_ID, id)).toBe(false);
    expect(await repository.findById(ORG_ID, id)).not.toBeNull();
  });

  it('applies a partial update without clearing untouched fields', async () => {
    const id = '019dd1a5-9235-70db-8d57-54040000000e';
    await repository.create(flag(id, 'partial.flag'));

    expect(await repository.update(ORG_ID, id, { enabled: true }, new Date())).toBe(true);
    const updated = await repository.findById(ORG_ID, id);

    expect(updated?.enabled).toBe(true);
    expect(updated?.rolloutPercentage).toBe(40);
    expect(updated?.description).toBe('before');
  });

  it('makes a freshly written flag visible to findAll and findById', async () => {
    const id = '019dd1a5-9235-70db-8d57-54040000000f';
    await repository.create(flag(id, 'read.after.write'));

    expect((await repository.findById(ORG_ID, id))?.key).toBe('read.after.write');
    expect((await repository.findAll(ORG_ID)).map((stored) => stored.id)).toEqual([id]);
  });

  it('paginates same-timestamp flags on the id tiebreaker', async () => {
    const sameTime = new Date('2026-07-01T00:00:00.000Z');
    const base = {
      organizationId: ORG_ID,
      description: null,
      enabled: true,
      rolloutPercentage: 100,
      createdAt: sameTime,
      updatedAt: sameTime,
    };
    for (const [id, key] of [
      ['019dd1a5-9235-70db-8d57-540400000011', 'a.flag'],
      ['019dd1a5-9235-70db-8d57-540400000012', 'b.flag'],
      ['019dd1a5-9235-70db-8d57-540400000013', 'c.flag'],
    ]) {
      await prisma.db.featureFlag.create({ data: { ...base, id, key } });
    }

    const first = await repository.findAllCursor({ organizationId: ORG_ID, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const last = first.items[first.items.length - 1];
    const second = await repository.findAllCursor({
      organizationId: ORG_ID,
      limit: 2,
      startingAfter: { createdAt: last.createdAt, id: last.id },
    });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });
}, 90_000);
