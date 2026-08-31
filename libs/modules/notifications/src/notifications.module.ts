import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { NOTIFICATION_REPOSITORY } from './domain/ports/notification-repository.port';
import { PrismaNotificationRepository } from './infrastructure/repositories/prisma-notification.repository';
import { ListNotificationsHandler } from './application/queries/list-notifications/list-notifications.handler';
import { CountUnreadNotificationsHandler } from './application/queries/count-unread-notifications/count-unread-notifications.handler';
import { CreateNotificationHandler } from './application/commands/create-notification/create-notification.handler';
import { MarkNotificationReadHandler } from './application/commands/mark-notification-read/mark-notification-read.handler';
import { MarkAllNotificationsReadHandler } from './application/commands/mark-all-notifications-read/mark-all-notifications-read.handler';
import { MembershipNotificationListener } from './application/listeners/membership-notification.listener';
import { NotificationsController } from './presentation/controllers/notifications.controller';

const providers = [
  { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
  CreateNotificationHandler,
  MembershipNotificationListener,
];

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [NotificationsController],
  providers: [
    ...providers,
    ListNotificationsHandler,
    CountUnreadNotificationsHandler,
    MarkNotificationReadHandler,
    MarkAllNotificationsReadHandler,
  ],
  exports: [NOTIFICATION_REPOSITORY],
})
export class NotificationsModule {}

// Listener-only slice for hosts that must not load the HTTP surface (worker, scheduler): the
// outbox relay republishes domain events in those processes, and the subscriber has to exist there
// for the notification to be written at all.
@Module({
  imports: [DatabaseModule, MessagingModule],
  providers,
  exports: [NOTIFICATION_REPOSITORY],
})
export class NotificationsListenersModule {}
