import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepositoryPort,
} from './notification-repository.port';

export interface MarkAllNotificationsReadResult {
  marked: number;
}

export class MarkAllNotificationsReadCommand extends Command<MarkAllNotificationsReadResult> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
  ) {
    super();
  }
}

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
