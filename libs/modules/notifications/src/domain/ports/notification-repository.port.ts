import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import type { Notification } from '../entities/notification.entity';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

export interface FindNotificationsCursorOptions {
  organizationId: string;
  userId: string;
  startingAfter?: DecodedCursor;
  limit: number;
  unreadOnly: boolean;
}

export interface FindNotificationsCursorResult {
  items: Notification[];
  hasMore: boolean;
}

export interface NotificationRepositoryPort {
  findAllCursor(options: FindNotificationsCursorOptions): Promise<FindNotificationsCursorResult>;
  countUnread(organizationId: string, userId: string): Promise<number>;
  create(notification: Notification): Promise<void>;
  /** Compare-and-set from unread to read; false when the row was missing or already read. */
  markRead(organizationId: string, userId: string, id: string, readAt: Date): Promise<boolean>;
  markAllRead(organizationId: string, userId: string, readAt: Date): Promise<number>;
  exists(organizationId: string, userId: string, id: string): Promise<boolean>;
}
