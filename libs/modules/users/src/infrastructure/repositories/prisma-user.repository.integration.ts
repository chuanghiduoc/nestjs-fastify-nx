import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { createTestContainers, DatabaseCleaner } from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
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

    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
    });

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
}, 90_000);
