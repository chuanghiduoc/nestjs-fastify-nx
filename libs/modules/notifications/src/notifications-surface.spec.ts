import { describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Prisma, type PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { generateId } from '@nestjs-fastify-nx/shared';
import { Notification } from './domain/entities/notification.entity';
import { PrismaNotificationRepository } from './infrastructure/repositories/prisma-notification.repository';
import { NotificationsController } from './presentation/controllers/notifications.controller';
import { ListNotificationsFilterDto } from './presentation/dto/notification.dto';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91800001';
const USER_ID = '019dd1a5-9235-70db-8d57-54ef91800002';

const SESSION: AuthenticatedSession = {
  userId: USER_ID,
  email: 'member@example.com',
  name: 'Member',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's-1',
  sessionToken: 't-1',
  organizationId: ORG_ID,
};

function prismaDouble(methods: Record<string, unknown>): PrismaService {
  const db = { notification: methods };
  return { db, readTarget: () => db, writeTarget: () => db } as unknown as PrismaService;
}

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: generateId(),
    organizationId: ORG_ID,
    userId: USER_ID,
    type: 'organization.member_added',
    title: 'Welcome',
    body: 'You were added.',
    data: { role: 'member' },
    readAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaNotificationRepository', () => {
  it('scopes every listing to the organization and the caller', async () => {
    const findMany = vi.fn().mockResolvedValue([notificationRow()]);
    const repository = new PrismaNotificationRepository(prismaDouble({ findMany }));

    await repository.findAllCursor({
      organizationId: ORG_ID,
      userId: USER_ID,
      limit: 10,
      unreadOnly: false,
    });

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG_ID,
      userId: USER_ID,
    });
  });

  it('narrows to unread rows when asked', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaNotificationRepository(prismaDouble({ findMany }));

    await repository.findAllCursor({
      organizationId: ORG_ID,
      userId: USER_ID,
      limit: 10,
      unreadOnly: true,
    });

    expect(findMany.mock.calls[0][0].where.readAt).toBeNull();
  });

  it('adds a keyset predicate for a cursor and reports hasMore', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([notificationRow(), notificationRow(), notificationRow()]);
    const repository = new PrismaNotificationRepository(prismaDouble({ findMany }));
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const id = generateId();

    const result = await repository.findAllCursor({
      organizationId: ORG_ID,
      userId: USER_ID,
      limit: 2,
      unreadOnly: false,
      startingAfter: { createdAt, id },
    });

    expect(findMany.mock.calls[0][0].where.AND[0].OR).toHaveLength(2);
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('falls back to an empty object when the data column holds a scalar', async () => {
    const findMany = vi.fn().mockResolvedValue([notificationRow({ data: 'not-an-object' })]);
    const repository = new PrismaNotificationRepository(prismaDouble({ findMany }));

    const result = await repository.findAllCursor({
      organizationId: ORG_ID,
      userId: USER_ID,
      limit: 10,
      unreadOnly: false,
    });

    expect(result.items[0].data).toEqual({});
  });

  it('treats a duplicate id as outbox redelivery, not a failure', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '7.0.0',
      meta: {},
    });
    const repository = new PrismaNotificationRepository(
      prismaDouble({ create: vi.fn().mockRejectedValue(duplicate) }),
    );

    await expect(
      repository.create(
        Notification.create({
          organizationId: ORG_ID,
          userId: USER_ID,
          type: 'test',
          title: 'T',
          body: 'B',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('propagates a failure it cannot classify', async () => {
    const failure = new Error('connection lost');
    const repository = new PrismaNotificationRepository(
      prismaDouble({ create: vi.fn().mockRejectedValue(failure) }),
    );

    await expect(
      repository.create(
        Notification.create({
          organizationId: ORG_ID,
          userId: USER_ID,
          type: 'test',
          title: 'T',
          body: 'B',
        }),
      ),
    ).rejects.toBe(failure);
  });

  it('marks read only an unread row owned by the caller', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaNotificationRepository(prismaDouble({ updateMany }));
    const id = generateId();

    expect(await repository.markRead(ORG_ID, USER_ID, id, new Date())).toBe(false);
    expect(updateMany.mock.calls[0][0].where).toEqual({
      id,
      organizationId: ORG_ID,
      userId: USER_ID,
      readAt: null,
    });
  });

  it('reports how many rows a mark-all touched', async () => {
    const repository = new PrismaNotificationRepository(
      prismaDouble({ updateMany: vi.fn().mockResolvedValue({ count: 3 }) }),
    );

    expect(await repository.markAllRead(ORG_ID, USER_ID, new Date())).toBe(3);
  });

  it('counts unread rows for the caller', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const repository = new PrismaNotificationRepository(prismaDouble({ count }));

    expect(await repository.countUnread(ORG_ID, USER_ID)).toBe(2);
    expect(count.mock.calls[0][0].where).toEqual({
      organizationId: ORG_ID,
      userId: USER_ID,
      readAt: null,
    });
  });

  it('scopes the existence check to the caller', async () => {
    const repository = new PrismaNotificationRepository(
      prismaDouble({ findFirst: vi.fn().mockResolvedValue(null) }),
    );

    expect(await repository.exists(ORG_ID, USER_ID, generateId())).toBe(false);
  });
});

describe('NotificationsController', () => {
  function build() {
    const queryBus = { execute: vi.fn() };
    const commandBus = { execute: vi.fn() };
    return {
      queryBus,
      commandBus,
      controller: new NotificationsController(
        queryBus as unknown as QueryBus,
        commandBus as unknown as CommandBus,
      ),
    };
  }

  it('passes the caller identity into the list query', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [], hasMore: false, lastCursor: null });
    const filter = Object.assign(new ListNotificationsFilterDto(), {
      limit: 10,
      unreadOnly: true,
    });

    const response = await controller.list(SESSION, filter);

    expect(response.url).toBe('/api/v1/notifications');
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID, unreadOnly: true }),
    );
  });

  it('reads the unread count for the caller', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ unread: 4 });

    expect(await controller.unreadCount(SESSION)).toEqual({ unread: 4 });
  });

  it('dispatches mark-read and mark-all-read commands', async () => {
    const { commandBus, controller } = build();
    commandBus.execute.mockResolvedValue({ marked: 2 });
    const id = generateId();

    await controller.markRead(SESSION, id);
    await controller.markAllRead(SESSION);

    expect(commandBus.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID, id }),
    );
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
    );
  });
});
