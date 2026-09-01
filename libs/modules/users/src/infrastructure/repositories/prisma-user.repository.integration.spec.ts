import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import { UserFactory } from '../../testing/user.factory';
import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90300001';

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
    await prismaService?.onModuleDestroy();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    UserFactory.reset();
    await prismaService.db.organization.create({
      data: { id: ORG_ID, name: 'Integration Org', slug: 'integration-org' },
    });
  });

  // findAllCursor lists members of one organization, so a saved user is invisible until it has a
  // membership — which is exactly the tenant scoping this asserts.
  async function saveAsMember(user: Parameters<typeof repository.save>[0]): Promise<void> {
    await repository.save(user);
    await prismaService.db.member.create({
      data: { organizationId: ORG_ID, userId: user.id, role: 'member' },
    });
  }

  it('saves and retrieves user by id', async () => {
    const user = UserFactory.create({ email: 'repo@test.com' });
    await repository.save(user);

    const found = await repository.findById(user.id);
    if (!found) throw new Error('expected user to be persisted');
    expect(found.email.toString()).toBe('repo@test.com');
  });

  it('returns null for unknown id', async () => {
    // A syntactically valid UUID with no row exercises the not-found branch
    // without tripping the Postgres type check.
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
      for (const u of users) await saveAsMember(u);

      const result = await repository.findAllCursor({ organizationId: ORG_ID, limit: 10 });
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it('returns hasMore=true when items exceed limit', async () => {
      for (let i = 0; i < 5; i++) {
        await saveAsMember(UserFactory.create({ email: `page${i}@test.com` }));
      }

      const result = await repository.findAllCursor({ organizationId: ORG_ID, limit: 3 });
      expect(result.items).toHaveLength(3);
      expect(result.hasMore).toBe(true);
    });

    it('paginates 30 users into 3 pages of 10 with no overlaps', async () => {
      // The composite createdAt/id cursor is stable when timestamps match.
      for (let i = 0; i < 30; i++) {
        const user = UserFactory.create({ email: `bulk${i}@test.com` });
        await saveAsMember(user);
      }

      const seenIds = new Set<string>();
      let cursor: DecodedCursor | undefined;
      let pagesRead = 0;

      for (let page = 0; page < 3; page++) {
        const result = await repository.findAllCursor({
          organizationId: ORG_ID,
          limit: 10,
          startingAfter: cursor,
        });
        expect(result.items).toHaveLength(10);

        for (const item of result.items) {
          expect(seenIds.has(item.id)).toBe(false);
          seenIds.add(item.id);
        }

        const last = result.items[result.items.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
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

    // The users table is global identity with no row-level security behind it, so this join is the
    // only thing standing between one tenant and another tenant's member list.
    it('never returns a user who belongs to another organization', async () => {
      const otherOrgId = '019dd1a5-9235-70db-8d57-54ef90300002';
      await prismaService.db.organization.create({
        data: { id: otherOrgId, name: 'Other', slug: 'other-org' },
      });

      const mine = UserFactory.create({ email: 'mine@test.com' });
      await saveAsMember(mine);

      const theirs = UserFactory.create({ email: 'theirs@test.com' });
      await repository.save(theirs);
      await prismaService.db.member.create({
        data: { organizationId: otherOrgId, userId: theirs.id, role: 'member' },
      });

      const result = await repository.findAllCursor({ organizationId: ORG_ID, limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].email.toString()).toBe('mine@test.com');
    });

    it('excludes a user with no membership at all', async () => {
      await repository.save(UserFactory.create({ email: 'orphan@test.com' }));

      const result = await repository.findAllCursor({ organizationId: ORG_ID, limit: 10 });

      expect(result.items).toHaveLength(0);
    });

    it('filters by search term', async () => {
      await saveAsMember(UserFactory.create({ email: 'alpha@test.com' }));
      await saveAsMember(UserFactory.create({ email: 'beta@test.com' }));

      const result = await repository.findAllCursor({
        organizationId: ORG_ID,
        limit: 10,
        search: 'alpha',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].email.toString()).toBe('alpha@test.com');
    });

    it('treats % and _ in the search term as literal characters, not SQL wildcards', async () => {
      await saveAsMember(UserFactory.create({ email: '50%off@test.com' }));
      await saveAsMember(UserFactory.create({ email: 'has_underscore@test.com' }));
      await saveAsMember(UserFactory.create({ email: 'unrelated@test.com' }));

      const percentResult = await repository.findAllCursor({
        organizationId: ORG_ID,
        limit: 10,
        search: '50%off',
      });
      expect(percentResult.items).toHaveLength(1);
      expect(percentResult.items[0].email.toString()).toBe('50%off@test.com');

      const underscoreResult = await repository.findAllCursor({
        organizationId: ORG_ID,
        limit: 10,
        search: 'has_underscore',
      });
      expect(underscoreResult.items).toHaveLength(1);
      expect(underscoreResult.items[0].email.toString()).toBe('has_underscore@test.com');
    });

    it('filters by membership role within the organization', async () => {
      const admin = UserFactory.create({ email: 'admin@test.com' });
      await repository.save(admin);
      await prismaService.db.member.create({
        data: { organizationId: ORG_ID, userId: admin.id, role: 'admin' },
      });
      await saveAsMember(UserFactory.create({ email: 'member@test.com' }));

      const result = await repository.findAllCursor({
        organizationId: ORG_ID,
        limit: 10,
        role: 'admin',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].email.toString()).toBe('admin@test.com');
    });

    it('keeps the organization scope when role and search are combined', async () => {
      const otherOrgId = '019dd1a5-9235-70db-8d57-54ef90300003';
      await prismaService.db.organization.create({
        data: { id: otherOrgId, name: 'Other Role Org', slug: 'other-role-org' },
      });

      const mine = UserFactory.create({
        email: 'admin-mine@test.com',
        name: 'Shared Admin',
      });
      await repository.save(mine);
      await prismaService.db.member.create({
        data: { organizationId: ORG_ID, userId: mine.id, role: 'admin' },
      });

      const theirs = UserFactory.create({
        email: 'admin-theirs@test.com',
        name: 'Shared Admin',
      });
      await repository.save(theirs);
      await prismaService.db.member.create({
        data: { organizationId: otherOrgId, userId: theirs.id, role: 'admin' },
      });

      const result = await repository.findAllCursor({
        organizationId: ORG_ID,
        limit: 10,
        role: 'admin',
        search: 'Shared Admin',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(mine.id);
    });

    it('paginates role-filtered results with the same cursor semantics', async () => {
      for (let i = 0; i < 3; i++) {
        const admin = UserFactory.create({ email: `paged-admin${i}@test.com` });
        await repository.save(admin);
        await prismaService.db.member.create({
          data: { organizationId: ORG_ID, userId: admin.id, role: 'admin' },
        });
      }
      await saveAsMember(UserFactory.create({ email: 'paged-member@test.com' }));

      const page1 = await repository.findAllCursor({
        organizationId: ORG_ID,
        limit: 2,
        role: 'admin',
      });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const last = page1.items[page1.items.length - 1];
      const page2 = await repository.findAllCursor({
        organizationId: ORG_ID,
        limit: 2,
        role: 'admin',
        startingAfter: { createdAt: last.createdAt, id: last.id },
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });
  });
}, 90_000);
