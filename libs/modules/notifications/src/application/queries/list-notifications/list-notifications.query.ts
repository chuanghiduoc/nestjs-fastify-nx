import { Query } from '@nestjs/cqrs';
import type { NotificationDto } from '../../dto/notification.dto';

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
