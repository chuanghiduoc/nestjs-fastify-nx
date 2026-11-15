import { Module } from '@nestjs/common';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { NOTIFICATION_REPOSITORY } from './notification-repository.port';
import { PrismaNotificationRepository } from './prisma-notification.repository';
import { ListNotificationsHandler } from './list-notifications';
import { CountUnreadNotificationsHandler } from './count-unread-notifications';
import { CreateNotificationHandler } from './create-notification';
import { MarkNotificationReadHandler } from './mark-notification-read';
import { MarkAllNotificationsReadHandler } from './mark-all-notifications-read';
import { MembershipNotificationListener } from './membership-notification.listener';
import { NotificationsController } from './notifications.controller';

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
})
export class NotificationsModule {}

// Listener-only slice for hosts that must not load the HTTP surface (worker, scheduler): the
// outbox relay republishes domain events in those processes, and the subscriber has to exist there
// for the notification to be written at all.
@Module({
  imports: [DatabaseModule, MessagingModule],
  providers,
})
export class NotificationsListenersModule {}
