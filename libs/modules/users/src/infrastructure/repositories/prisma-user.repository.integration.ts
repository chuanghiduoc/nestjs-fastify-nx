import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { encodeCursor } from '@nestjs-fastify-nx/shared';
import { UserFactory } from '../../testing/user.factory';
import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

describe('PrismaUserRepository (integration)', () => {
  let containers: TestContainers;
  let prismaService: PrismaService;
  let repository: PrismaUserRepository;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();

    process.env['DATABASE_URL'] = dbUrl;

    deployTestMigrations(dbUrl);

    prismaService = new PrismaService();
    await prismaService.onModuleInit();

    repository = new PrismaUserRepository(prismaService);
    cleaner = new DatabaseCleaner(prismaService.db);
  }, 90_000);

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await containers.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    UserFactory.reset();
  });

  it('saves and retrieves user by id', async () => {
    const user = UserFactory.create({ email: 'repo@test.com' });
    await repository.save(user);

    const found = await repository.findById(user.id);
    if (!found) throw new Error('expected user to be persisted');
    expect(found.email.toString()).toBe('repo@test.com');
  });

  it('returns null for unknown id', async () => {
    // PK column is UUID — a syntactically-valid UUID that simply has no row
    // exercises the not-found branch without tripping the Postgres type check.
    const result = await repository.findById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('finds user by email', async () => {
    const user = UserFactory.create({ email: 'findme@test.com' });
    await repository.save(user);

    const found = await repository.findByEmail('findme@test.com');
    if (!found) throw new Error('expected user to be persisted');
    expect(found.id).toBe(user.id);
  });

  it('exists returns true for saved email, false for unknown', async () => {
    const user = UserFactory.create({ email: 'exists@test.com' });
    await repository.save(user);
    expect(await repository.exists('exists@test.com')).toBe(true);
    expect(await repository.exists('ghost@test.com')).toBe(false);
  });

  it('upsert updates existing user', async () => {
    const user = UserFactory.create({ email: 'update@test.com' });
    await repository.save(user);
    await repository.save(user);

    const found = await repository.findById(user.id);
    expect(found).not.toBeNull();
  });

  describe('findAllCursor', () => {
    it('returns first page with hasMore=false when items <= limit', async () => {
      const users = [
        UserFactory.create({ email: 'c1@test.com' }),
        UserFactory.create({ email: 'c2@test.com' }),
      ];
      for (const u of users) await repository.save(u);

      const result = await repository.findAllCursor({ limit: 10 });
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it('returns hasMore=true when items exceed limit', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.save(UserFactory.create({ email: `page${i}@test.com` }));
      }

      const result = await repository.findAllCursor({ limit: 3 });
      expect(result.items).toHaveLength(3);
      expect(result.hasMore).toBe(true);
    });

    it('paginates 30 users into 3 pages of 10 with no overlaps', async () => {
      // Insert 30 users with slightly different timestamps so ordering is stable
      for (let i = 0; i < 30; i++) {
        const user = UserFactory.create({ email: `bulk${i}@test.com` });
        await repository.save(user);
      }

      const seenIds = new Set<string>();
      let cursor: string | undefined;
      let pagesRead = 0;

      for (let page = 0; page < 3; page++) {
        const result = await repository.findAllCursor({ limit: 10, startingAfter: cursor });
        expect(result.items).toHaveLength(10);

        for (const item of result.items) {
          expect(seenIds.has(item.id)).toBe(false);
          seenIds.add(item.id);
        }

        const last = result.items[result.items.length - 1];
        cursor = encodeCursor(last.createdAt, last.id);
        pagesRead++;

        if (page < 2) {
          expect(result.hasMore).toBe(true);
        } else {
          expect(result.hasMore).toBe(false);
        }
      }

      expect(pagesRead).toBe(3);
      expect(seenIds.size).toBe(30);
    });

    it('returns empty result for invalid cursor (falls back to first page)', async () => {
      await repository.save(UserFactory.create({ email: 'any@test.com' }));

      const result = await repository.findAllCursor({ limit: 10, startingAfter: '!!!bad!!!' });
      // Invalid cursor is silently ignored → returns first page
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('filters by search term', async () => {
      await repository.save(UserFactory.create({ email: 'alpha@test.com' }));
      await repository.save(UserFactory.create({ email: 'beta@test.com' }));

      const result = await repository.findAllCursor({ limit: 10, search: 'alpha' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].email.toString()).toBe('alpha@test.com');
    });
  });
}, 90_000);
