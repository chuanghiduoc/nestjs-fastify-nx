import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, encodeCursor, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { NOTIFICATION_REPOSITORY } from '../../../domain/ports/notification-repository.port';
import type { NotificationRepositoryPort } from '../../../domain/ports/notification-repository.port';
import type { NotificationDto } from '../../dto/notification.dto';
import { ListNotificationsQuery, type ListNotificationsResult } from './list-notifications.query';

@QueryHandler(ListNotificationsQuery)
export class ListNotificationsHandler implements IQueryHandler<
  ListNotificationsQuery,
  ListNotificationsResult
> {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepositoryPort,
  ) {}

  async execute(query: ListNotificationsQuery): Promise<ListNotificationsResult> {
    const { items, hasMore } = await this.notifications.findAllCursor({
      organizationId: query.organizationId,
      userId: query.userId,
      startingAfter: this.decodeStartingAfter(query.startingAfter),
      limit: query.limit,
      unreadOnly: query.unreadOnly,
    });

    const data: NotificationDto[] = items.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    }));

    const lastItem = items[items.length - 1];
    return {
      data,
      hasMore,
      lastCursor: lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null,
    };
  }

  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;
    const decoded = decodeCursor(raw);
    if (!decoded) throw new DomainException(invalidCursorProblem());
    return decoded;
  }
}
