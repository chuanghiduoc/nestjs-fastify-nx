import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Notification } from './notification.entity';
import { PrismaNotificationRepository } from './prisma-notification.repository';

const ORG_ID = '019dd1a5-9235-70db-8d57-540200000001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-540200000002';
const USER_ID = '019dd1a5-9235-70db-8d57-540200000003';
const OTHER_USER_ID = '019dd1a5-9235-70db-8d57-540200000004';

function notification(id: string, userId: string, overrides: { organizationId?: string } = {}) {
  return Notification.create({
    id,
    organizationId: overrides.organizationId ?? ORG_ID,
    userId,
    type: 'organization.member_added',
    title: 'Welcome',
    body: 'You were added.',
  });
}

describe('PrismaNotificationRepository (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let repository: PrismaNotificationRepository;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();
    repository = new PrismaNotificationRepository(prisma);
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
        { id: ORG_ID, name: 'Notifications Org', slug: 'notifications-org' },
        { id: OTHER_ORG_ID, name: 'Other Org', slug: 'notifications-other' },
      ],
    });
    await prisma.db.user.createMany({
      data: [
        { id: USER_ID, email: 'notify@test.com', name: 'Notify', updatedAt: new Date() },
        { id: OTHER_USER_ID, email: 'other-notify@test.com', name: 'Other', updatedAt: new Date() },
      ],
    });
  });

  it('treats a redelivered deterministic id as a no-op', async () => {
    const entity = notification('019dd1a5-9235-70db-8d57-54020000000a', USER_ID);

    await repository.create(entity);
    await repository.create(entity);

    expect(await prisma.db.notification.count({ where: { organizationId: ORG_ID } })).toBe(1);
  });

  it('scopes the list to the organization and the user', async () => {
    await repository.create(notification('019dd1a5-9235-70db-8d57-54020000000b', USER_ID));
    await repository.create(notification('019dd1a5-9235-70db-8d57-54020000000c', OTHER_USER_ID));
    await repository.create(
      notification('019dd1a5-9235-70db-8d57-54020000000d', USER_ID, {
        organizationId: OTHER_ORG_ID,
      }),
    );

    const result = await repository.findAllCursor({
      organizationId: ORG_ID,
      userId: USER_ID,
      limit: 10,
      unreadOnly: false,
    });

    expect(result.items.map((item) => item.id)).toEqual(['019dd1a5-9235-70db-8d57-54020000000b']);
  });

  it('paginates same-timestamp notifications on the id tiebreaker', async () => {
    const sameTime = new Date('2026-03-01T00:00:00.000Z');
    const base = {
      id: '',
      organizationId: ORG_ID,
      userId: USER_ID,
      type: 't',
      title: 't',
      body: 'b',
      data: {},
      readAt: null,
      createdAt: sameTime,
    };
    for (const id of [
      '019dd1a5-9235-70db-8d57-540200000011',
      '019dd1a5-9235-70db-8d57-540200000012',
      '019dd1a5-9235-70db-8d57-540200000013',
    ]) {
      await prisma.db.notification.create({ data: { ...base, id } });
    }

    const first = await repository.findAllCursor({
      organizationId: ORG_ID,
      userId: USER_ID,
      limit: 2,
      unreadOnly: false,
    });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const last = first.items[first.items.length - 1];
    const second = await repository.findAllCursor({
      organizationId: ORG_ID,
      userId: USER_ID,
      limit: 2,
      unreadOnly: false,
      startingAfter: { createdAt: last.createdAt, id: last.id },
    });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it('filters unread notifications and counts them per user', async () => {
    const read = notification('019dd1a5-9235-70db-8d57-54020000000e', USER_ID);
    const unread = notification('019dd1a5-9235-70db-8d57-54020000000f', USER_ID);
    await repository.create(read);
    await repository.create(unread);
    await repository.markRead(ORG_ID, USER_ID, read.id, new Date());

    const result = await repository.findAllCursor({
      organizationId: ORG_ID,
      userId: USER_ID,
      limit: 10,
      unreadOnly: true,
    });

    expect(result.items.map((item) => item.id)).toEqual([unread.id]);
    expect(await repository.countUnread(ORG_ID, USER_ID)).toBe(1);
  });

  it('cannot mark another user notification as read', async () => {
    const id = '019dd1a5-9235-70db-8d57-540200000010';
    await repository.create(notification(id, OTHER_USER_ID));

    expect(await repository.markRead(ORG_ID, USER_ID, id, new Date())).toBe(false);
    expect(await repository.exists(ORG_ID, OTHER_USER_ID, id)).toBe(true);
  });
}, 90_000);
