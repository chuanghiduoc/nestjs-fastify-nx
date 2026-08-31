import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import { Notification } from '../../domain/entities/notification.entity';
import type {
  FindNotificationsCursorOptions,
  FindNotificationsCursorResult,
  NotificationRepositoryPort,
} from '../../domain/ports/notification-repository.port';

type NotificationRow = {
  id: string;
  organizationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
};

function toData(raw: Prisma.JsonValue): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
}

function toEntity(row: NotificationRow): Notification {
  return Notification.reconstitute({ ...row, data: toData(row.data) });
}

@Injectable()
export class PrismaNotificationRepository implements NotificationRepositoryPort {
  private readonly logger = new Logger(PrismaNotificationRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAllCursor(
    options: FindNotificationsCursorOptions,
  ): Promise<FindNotificationsCursorResult> {
    const { organizationId, userId, startingAfter, limit, unreadOnly } = options;

    const where: Prisma.NotificationWhereInput = { organizationId, userId };
    if (unreadOnly) where.readAt = null;
    if (startingAfter) {
      where.AND = [
        {
          OR: [
            { createdAt: { lt: startingAfter.createdAt } },
            { AND: [{ createdAt: startingAfter.createdAt }, { id: { lt: startingAfter.id } }] },
          ],
        },
      ];
    }

    const rows = await this.prisma.readTarget().notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    return { items: (hasMore ? rows.slice(0, limit) : rows).map(toEntity), hasMore };
  }

  async countUnread(organizationId: string, userId: string): Promise<number> {
    return this.prisma
      .readTarget()
      .notification.count({ where: { organizationId, userId, readAt: null } });
  }

  async create(notification: Notification): Promise<void> {
    try {
      await this.prisma.writeTarget().notification.create({
        data: {
          id: notification.id,
          organizationId: notification.organizationId,
          userId: notification.userId,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          data: notification.data as Prisma.InputJsonValue,
          createdAt: notification.createdAt,
        },
      });
    } catch (err) {
      // A deterministic id makes outbox redelivery collide on the primary key; that is the
      // idempotency signal, not a failure.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug(`notifications duplicate id=${notification.id} — redelivery, ignoring`);
        return;
      }
      throw err;
    }
  }

  async markRead(
    organizationId: string,
    userId: string,
    id: string,
    readAt: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.writeTarget().notification.updateMany({
      where: { id, organizationId, userId, readAt: null },
      data: { readAt },
    });
    return count > 0;
  }

  async markAllRead(organizationId: string, userId: string, readAt: Date): Promise<number> {
    const { count } = await this.prisma.writeTarget().notification.updateMany({
      where: { organizationId, userId, readAt: null },
      data: { readAt },
    });
    return count;
  }

  async exists(organizationId: string, userId: string, id: string): Promise<boolean> {
    const row = await this.prisma
      .writeTarget()
      .notification.findFirst({ where: { id, organizationId, userId }, select: { id: true } });
    return row !== null;
  }
}
