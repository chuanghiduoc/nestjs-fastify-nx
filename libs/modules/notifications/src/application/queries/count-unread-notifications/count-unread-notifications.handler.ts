import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { NOTIFICATION_REPOSITORY } from '../../../domain/ports/notification-repository.port';
import type { NotificationRepositoryPort } from '../../../domain/ports/notification-repository.port';
import type { UnreadCountDto } from '../../dto/notification.dto';
import { CountUnreadNotificationsQuery } from './count-unread-notifications.query';

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
