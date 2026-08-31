import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { NOTIFICATION_REPOSITORY } from '../../../domain/ports/notification-repository.port';
import type { NotificationRepositoryPort } from '../../../domain/ports/notification-repository.port';
import { Notification } from '../../../domain/entities/notification.entity';
import { CreateNotificationCommand } from './create-notification.command';

@CommandHandler(CreateNotificationCommand)
export class CreateNotificationHandler implements ICommandHandler<CreateNotificationCommand, void> {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepositoryPort,
  ) {}

  async execute(command: CreateNotificationCommand): Promise<void> {
    await this.notifications.create(
      Notification.create({
        id: command.id,
        organizationId: command.organizationId,
        userId: command.userId,
        type: command.type,
        title: command.title,
        body: command.body,
        data: command.data,
        createdAt: command.occurredAt,
      }),
    );
  }
}
