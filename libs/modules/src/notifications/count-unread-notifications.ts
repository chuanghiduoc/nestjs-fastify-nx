import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepositoryPort,
} from './notification-repository.port';

export interface UnreadCountDto {
  unread: number;
}

export class CountUnreadNotificationsQuery extends Query<UnreadCountDto> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
  ) {
    super();
  }
}

@QueryHandler(CountUnreadNotificationsQuery)
export class CountUnreadNotificationsHandler implements IQueryHandler<
  CountUnreadNotificationsQuery,
  UnreadCountDto
> {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepositoryPort,
  ) {}

  async execute(query: CountUnreadNotificationsQuery): Promise<UnreadCountDto> {
    return {
      unread: await this.notifications.countUnread(query.organizationId, query.userId),
    };
  }
}
