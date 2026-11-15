import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, lastCursorOf, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepositoryPort,
} from './notification-repository.port';

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export interface ListNotificationsResult {
  data: NotificationDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListNotificationsFilters {
  readonly startingAfter?: string;
  readonly unreadOnly?: boolean;
}

export class ListNotificationsQuery extends Query<ListNotificationsResult> {
  readonly organizationId: string;
  readonly userId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly unreadOnly: boolean;

  constructor(
    organizationId: string,
    userId: string,
    limit: number,
    filters: ListNotificationsFilters = {},
  ) {
    super();
    this.organizationId = organizationId;
    this.userId = userId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.unreadOnly = filters.unreadOnly ?? false;
  }
}

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

    return { data, hasMore, lastCursor: lastCursorOf(items) };
  }

  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;
    const decoded = decodeCursor(raw);
    if (!decoded) throw new DomainException(invalidCursorProblem());
    return decoded;
  }
}
