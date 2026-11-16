import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PrismaSessionRepository } from './prisma-session.repository';

const USER_ID = '019dd1a5-9235-70db-8d57-540100000001';
const OTHER_USER_ID = '019dd1a5-9235-70db-8d57-540100000002';

describe('PrismaSessionRepository (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let repository: PrismaSessionRepository;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();
    repository = new PrismaSessionRepository(prisma);
    cleaner = new DatabaseCleaner(prisma.db);
  }, 90_000);

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    await prisma.db.user.createMany({
      data: [
        { id: USER_ID, email: 'sessions@test.com', name: 'Sessions', updatedAt: new Date() },
        { id: OTHER_USER_ID, email: 'other@test.com', name: 'Other', updatedAt: new Date() },
      ],
    });
  });

  async function seedSession(
    id: string,
    userId: string,
    overrides: { expiresAt?: Date; createdAt?: Date } = {},
  ): Promise<void> {
    await prisma.db.session.create({
      data: {
        id,
        token: `token-${id}`,
        userId,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
        updatedAt: new Date(),
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
  }

  it('lists only the caller sessions, newest first', async () => {
    const older = new Date('2026-01-01T00:00:00.000Z');
    const newer = new Date('2026-01-02T00:00:00.000Z');
    await seedSession('019dd1a5-9235-70db-8d57-54010000000a', USER_ID, { createdAt: older });
    await seedSession('019dd1a5-9235-70db-8d57-54010000000b', USER_ID, { createdAt: newer });
    await seedSession('019dd1a5-9235-70db-8d57-54010000000c', OTHER_USER_ID, {
      createdAt: newer,
    });

    const result = await repository.findAllCursor({
      userId: USER_ID,
      limit: 10,
      activeOnly: false,
      now: new Date(),
    });

    expect(result.items.map((session) => session.id)).toEqual([
      '019dd1a5-9235-70db-8d57-54010000000b',
      '019dd1a5-9235-70db-8d57-54010000000a',
    ]);
  });

  it('never projects the session token', async () => {
    await seedSession('019dd1a5-9235-70db-8d57-54010000000d', USER_ID);

    const result = await repository.findAllCursor({
      userId: USER_ID,
      limit: 10,
      activeOnly: false,
      now: new Date(),
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('token');
  });

  it('paginates same-timestamp sessions without repeating a row', async () => {
    const sameTime = new Date('2026-02-01T00:00:00.000Z');
    for (const suffix of ['01', '02', '03']) {
      await seedSession(`019dd1a5-9235-70db-8d57-5401000000${suffix}`, USER_ID, {
        createdAt: sameTime,
      });
    }

    const first = await repository.findAllCursor({
      userId: USER_ID,
      limit: 2,
      activeOnly: false,
      now: new Date(),
    });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const last = first.items[first.items.length - 1];
    const second = await repository.findAllCursor({
      userId: USER_ID,
      limit: 2,
      activeOnly: false,
      now: new Date(),
      startingAfter: { createdAt: last.createdAt, id: last.id },
    });

    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.items.map((session) => session.id)).not.toContain(last.id);
  });

  it('hides expired sessions when activeOnly is set', async () => {
    await seedSession('019dd1a5-9235-70db-8d57-54010000000d', USER_ID, {
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await seedSession('019dd1a5-9235-70db-8d57-54010000000e', USER_ID, {
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });

    const result = await repository.findAllCursor({
      userId: USER_ID,
      limit: 10,
      activeOnly: true,
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(result.items.map((session) => session.id)).toEqual([
      '019dd1a5-9235-70db-8d57-54010000000e',
    ]);
  });

  it('cannot delete a session owned by another user', async () => {
    const id = '019dd1a5-9235-70db-8d57-54010000000f';
    await seedSession(id, OTHER_USER_ID);

    expect(await repository.deleteForUser(USER_ID, id)).toBe(false);
    expect(await prisma.db.session.count({ where: { id } })).toBe(1);
  });

  it('revokes every other session of the caller and leaves other users untouched', async () => {
    const kept = '019dd1a5-9235-70db-8d57-540100000010';
    const revokedA = '019dd1a5-9235-70db-8d57-540100000011';
    const revokedB = '019dd1a5-9235-70db-8d57-540100000012';
    const other = '019dd1a5-9235-70db-8d57-540100000013';
    await seedSession(kept, USER_ID);
    await seedSession(revokedA, USER_ID);
    await seedSession(revokedB, USER_ID);
    await seedSession(other, OTHER_USER_ID);

    expect(await repository.deleteAllForUserExcept(USER_ID, kept)).toBe(2);
    expect(await prisma.db.session.count({ where: { userId: USER_ID } })).toBe(1);
    expect(await prisma.db.session.count({ where: { id: other } })).toBe(1);
  });
}, 90_000);
