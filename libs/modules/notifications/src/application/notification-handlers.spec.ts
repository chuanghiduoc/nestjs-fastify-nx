import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandBus } from '@nestjs/cqrs';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENTS, generateId } from '@nestjs-fastify-nx/shared';
import { InMemoryNotificationRepository } from '../testing/in-memory-notification-repository';
import { CreateNotificationHandler } from './commands/create-notification/create-notification.handler';
import { CreateNotificationCommand } from './commands/create-notification/create-notification.command';
import { MarkNotificationReadHandler } from './commands/mark-notification-read/mark-notification-read.handler';
import { MarkNotificationReadCommand } from './commands/mark-notification-read/mark-notification-read.command';
import { MarkAllNotificationsReadHandler } from './commands/mark-all-notifications-read/mark-all-notifications-read.handler';
import { MarkAllNotificationsReadCommand } from './commands/mark-all-notifications-read/mark-all-notifications-read.command';
import { ListNotificationsHandler } from './queries/list-notifications/list-notifications.handler';
import { ListNotificationsQuery } from './queries/list-notifications/list-notifications.query';
import { CountUnreadNotificationsHandler } from './queries/count-unread-notifications/count-unread-notifications.handler';
import { CountUnreadNotificationsQuery } from './queries/count-unread-notifications/count-unread-notifications.query';
import { MembershipNotificationListener } from './listeners/membership-notification.listener';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91000001';
const USER_ID = '019dd1a5-9235-70db-8d57-54ef91000002';
const OTHER_USER_ID = '019dd1a5-9235-70db-8d57-54ef91000003';

describe('notification handlers', () => {
  let repository: InMemoryNotificationRepository;

  async function seed(id: string, userId = USER_ID): Promise<void> {
    await new CreateNotificationHandler(repository).execute(
      new CreateNotificationCommand({
        id,
        organizationId: ORG_ID,
        userId,
        type: 'test',
        title: 'Title',
        body: 'Body',
      }),
    );
  }

  beforeEach(() => {
    repository = new InMemoryNotificationRepository();
  });

  it('creates a notification', async () => {
    await seed(generateId());

    expect(repository.size()).toBe(1);
  });

  it('treats a repeated deterministic id as a redelivery, not a second row', async () => {
    const id = generateId();
    await seed(id);
    await seed(id);

    expect(repository.size()).toBe(1);
  });

  it('lists only the caller’s notifications', async () => {
    await seed(generateId());
    await seed(generateId(), OTHER_USER_ID);

    const result = await new ListNotificationsHandler(repository).execute(
      new ListNotificationsQuery(ORG_ID, USER_ID, 20),
    );

    expect(result.data).toHaveLength(1);
  });

  it('filters to unread when asked', async () => {
    const read = generateId();
    await seed(read);
    await seed(generateId());
    await new MarkNotificationReadHandler(repository).execute(
      new MarkNotificationReadCommand(ORG_ID, USER_ID, read),
    );

    const result = await new ListNotificationsHandler(repository).execute(
      new ListNotificationsQuery(ORG_ID, USER_ID, 20, { unreadOnly: true }),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].readAt).toBeNull();
  });

  it('counts unread notifications for the caller', async () => {
    await seed(generateId());
    await seed(generateId());
    await seed(generateId(), OTHER_USER_ID);

    const result = await new CountUnreadNotificationsHandler(repository).execute(
      new CountUnreadNotificationsQuery(ORG_ID, USER_ID),
    );

    expect(result.unread).toBe(2);
  });

  it('marks one notification read, and repeating it is a no-op', async () => {
    const id = generateId();
    await seed(id);
    const handler = new MarkNotificationReadHandler(repository);

    await handler.execute(new MarkNotificationReadCommand(ORG_ID, USER_ID, id));

    await expect(
      handler.execute(new MarkNotificationReadCommand(ORG_ID, USER_ID, id)),
    ).resolves.toBeUndefined();
    expect(await repository.countUnread(ORG_ID, USER_ID)).toBe(0);
  });

  // A notification addressed to someone else must answer 404, not 403: a distinguishable 403
  // would confirm the row exists.
  it('answers not_found for a notification addressed to another user', async () => {
    const id = generateId();
    await seed(id, OTHER_USER_ID);

    const execute = new MarkNotificationReadHandler(repository).execute(
      new MarkNotificationReadCommand(ORG_ID, USER_ID, id),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('marks every unread notification of the caller and reports the count', async () => {
    await seed(generateId());
    await seed(generateId());
    await seed(generateId(), OTHER_USER_ID);

    const result = await new MarkAllNotificationsReadHandler(repository).execute(
      new MarkAllNotificationsReadCommand(ORG_ID, USER_ID),
    );

    expect(result.marked).toBe(2);
    expect(await repository.countUnread(ORG_ID, OTHER_USER_ID)).toBe(1);
  });

  it('rejects a malformed cursor', async () => {
    const execute = new ListNotificationsHandler(repository).execute(
      new ListNotificationsQuery(ORG_ID, USER_ID, 20, { startingAfter: '###' }),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'malformed' });
  });
});

describe('MembershipNotificationListener', () => {
  function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
    return {
      eventId: generateId(),
      eventType: DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ADDED,
      aggregateId: ORG_ID,
      organizationId: ORG_ID,
      occurredAt: new Date('2026-08-01T00:00:00.000Z'),
      payload: { userId: USER_ID, role: 'member' },
      ...overrides,
    } as DomainEvent;
  }

  it('dispatches a notification for a new member', async () => {
    const commandBus = { execute: vi.fn().mockResolvedValue(undefined) } as unknown as CommandBus;

    await new MembershipNotificationListener(commandBus).handleMemberAdded(event());

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
    );
  });

  it('derives the notification id from the outbox eventId so redelivery dedupes', async () => {
    const commandBus = { execute: vi.fn().mockResolvedValue(undefined) } as unknown as CommandBus;
    const domainEvent = event();

    await new MembershipNotificationListener(commandBus).handleMemberAdded(domainEvent);

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: domainEvent.eventId }),
    );
  });

  it('ignores an event whose payload carries no member', async () => {
    const commandBus = { execute: vi.fn() } as unknown as CommandBus;

    await new MembershipNotificationListener(commandBus).handleMemberAdded(event({ payload: {} }));

    expect(commandBus.execute).not.toHaveBeenCalled();
  });

  it('ignores an event with no organization context', async () => {
    const commandBus = { execute: vi.fn() } as unknown as CommandBus;

    await new MembershipNotificationListener(commandBus).handleMemberAdded(
      event({ organizationId: undefined }),
    );

    expect(commandBus.execute).not.toHaveBeenCalled();
  });

  it('notifies on a role change and carries the previous role', async () => {
    const commandBus = { execute: vi.fn().mockResolvedValue(undefined) } as unknown as CommandBus;

    await new MembershipNotificationListener(commandBus).handleRoleUpdated(
      event({
        eventType: DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ROLE_UPDATED,
        payload: { userId: USER_ID, role: 'admin', oldRole: 'member' },
      }),
    );

    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'admin', previousRole: 'member' } }),
    );
  });
});
