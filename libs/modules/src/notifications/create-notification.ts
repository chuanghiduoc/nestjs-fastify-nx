import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepositoryPort,
} from './notification-repository.port';
import { Notification } from './notification.entity';

export interface CreateNotificationInput {
  /** Deterministic id for idempotent writes (e.g. outbox eventId + recipient). */
  readonly id?: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
  readonly occurredAt?: Date;
}

export class CreateNotificationCommand extends Command<void> {
  readonly id?: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
  readonly occurredAt?: Date;

  constructor(input: CreateNotificationInput) {
    super();
    this.id = input.id;
    this.organizationId = input.organizationId;
    this.userId = input.userId;
    this.type = input.type;
    this.title = input.title;
    this.body = input.body;
    this.data = input.data;
    this.occurredAt = input.occurredAt;
  }
}

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
