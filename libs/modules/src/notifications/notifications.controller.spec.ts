import { describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { generateId } from '@nestjs-fastify-nx/shared';
import { NotificationsController } from './notifications.controller';
import { ListNotificationsFilterDto } from './notifications.dto';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef92200001';
const USER_ID = '019dd1a5-9235-70db-8d57-54ef92200002';
const SESSION_ID = '019dd1a5-9235-70db-8d57-54ef92200003';

const SESSION: AuthenticatedSession = {
  userId: USER_ID,
  email: 'member@example.com',
  name: 'Member',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: SESSION_ID,
  organizationId: ORG_ID,
};

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
