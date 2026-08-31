import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { NOTIFICATION_REPOSITORY } from '../../../domain/ports/notification-repository.port';
import type { NotificationRepositoryPort } from '../../../domain/ports/notification-repository.port';
import {
  MarkAllNotificationsReadCommand,
  type MarkAllNotificationsReadResult,
} from './mark-all-notifications-read.command';

@CommandHandler(MarkAllNotificationsReadCommand)
export class MarkAllNotificationsReadHandler implements ICommandHandler<
  MarkAllNotificationsReadCommand,
  MarkAllNotificationsReadResult
> {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepositoryPort,
  ) {}

  async execute(command: MarkAllNotificationsReadCommand): Promise<MarkAllNotificationsReadResult> {
    return {
      marked: await this.notifications.markAllRead(
        command.organizationId,
        command.userId,
        new Date(),
      ),
    };
  }
}
