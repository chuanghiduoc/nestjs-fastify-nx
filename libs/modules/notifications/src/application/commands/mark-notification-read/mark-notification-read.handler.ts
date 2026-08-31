import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { NOTIFICATION_REPOSITORY } from '../../../domain/ports/notification-repository.port';
import type { NotificationRepositoryPort } from '../../../domain/ports/notification-repository.port';
import { MarkNotificationReadCommand } from './mark-notification-read.command';

@CommandHandler(MarkNotificationReadCommand)
export class MarkNotificationReadHandler implements ICommandHandler<
  MarkNotificationReadCommand,
  void
> {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepositoryPort,
  ) {}

  // Marking an already-read notification is a no-op: the caller's intent already holds and a
  // retried request must stay safe. A row that belongs to someone else answers 404 rather than
  // 403, so the response cannot confirm that it exists.
  async execute(command: MarkNotificationReadCommand): Promise<void> {
    const marked = await this.notifications.markRead(
      command.organizationId,
      command.userId,
      command.id,
      new Date(),
    );
    if (marked) return;

    const exists = await this.notifications.exists(
      command.organizationId,
      command.userId,
      command.id,
    );
    if (exists) return;

    throw new DomainException({
      kind: 'not_found',
      code: ERROR_CODES.NOTIFICATION_NOT_FOUND,
      title: I18N_KEYS.common.not_found,
      messageKey: I18N_KEYS.errors.notifications.not_found,
      violations: [
        {
          path: 'id',
          code: ERROR_CODES.NOTIFICATION_NOT_FOUND,
          message: 'Notification not found',
          messageKey: I18N_KEYS.errors.notifications.not_found,
        },
      ],
    });
  }
}
