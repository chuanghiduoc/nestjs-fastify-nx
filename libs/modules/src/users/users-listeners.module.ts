import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { UserRegisteredListener } from './application/listeners/user-registered.listener';

// Listeners-only slice of the users feature for hosts that should not load the
// HTTP controller (e.g. scheduler/worker). It pulls in the same EventEmitter2
// instance MessagingModule wires up so @OnEvent('users.*') subscriptions in
// non-API processes receive the deliveries published by the outbox relay.
@Module({
  imports: [
    MessagingModule,
    RedisQueueModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL_NOTIFICATION }),
  ],
  providers: [UserRegisteredListener],
})
export class UsersListenersModule {}
