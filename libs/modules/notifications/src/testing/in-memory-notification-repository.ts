import { Notification } from '../domain/entities/notification.entity';
import type {
  FindNotificationsCursorOptions,
  FindNotificationsCursorResult,
  NotificationRepositoryPort,
} from '../domain/ports/notification-repository.port';

export class InMemoryNotificationRepository implements NotificationRepositoryPort {
  private readonly notifications = new Map<string, Notification>();

  findAllCursor(options: FindNotificationsCursorOptions): Promise<FindNotificationsCursorResult> {
    const matching = [...this.notifications.values()]
      .filter(
        (notification) =>
          notification.organizationId === options.organizationId &&
          notification.userId === options.userId,
      )
      .filter((notification) => (options.unreadOnly ? !notification.isRead : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return Promise.resolve({
      items: matching.slice(0, options.limit),
      hasMore: matching.length > options.limit,
    });
  }

  countUnread(organizationId: string, userId: string): Promise<number> {
    return Promise.resolve(
      [...this.notifications.values()].filter(
        (notification) =>
          notification.organizationId === organizationId &&
          notification.userId === userId &&
          !notification.isRead,
      ).length,
    );
  }

  create(notification: Notification): Promise<void> {
    if (!this.notifications.has(notification.id)) {
      this.notifications.set(notification.id, notification);
    }
    return Promise.resolve();
  }

  markRead(organizationId: string, userId: string, id: string, readAt: Date): Promise<boolean> {
    const notification = this.notifications.get(id);
    if (
      !notification ||
      notification.organizationId !== organizationId ||
      notification.userId !== userId ||
      notification.isRead
    ) {
      return Promise.resolve(false);
    }

    this.notifications.set(
      id,
      Notification.reconstitute({
        id: notification.id,
        organizationId: notification.organizationId,
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        readAt,
        createdAt: notification.createdAt,
      }),
    );
    return Promise.resolve(true);
  }

  async markAllRead(organizationId: string, userId: string, readAt: Date): Promise<number> {
    let marked = 0;
    for (const notification of [...this.notifications.values()]) {
      if (await this.markRead(organizationId, userId, notification.id, readAt)) marked += 1;
    }
    return marked;
  }

  exists(organizationId: string, userId: string, id: string): Promise<boolean> {
    const notification = this.notifications.get(id);
    return Promise.resolve(
      notification !== undefined &&
        notification.organizationId === organizationId &&
        notification.userId === userId,
    );
  }

  size(): number {
    return this.notifications.size;
  }
}
