import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { MessagingModule } from '@nestjs-fastify-nx/infra-messaging';
import { RedisQueueModule } from '@nestjs-fastify-nx/infra-redis';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { USER_REPOSITORY_PORT } from './domain/ports/user-repository.port';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository';
import { GetUserProfileHandler } from './application/queries/get-user-profile/get-user-profile.handler';
import { ListUsersHandler } from './application/queries/list-users/list-users.handler';
import { UserRegisteredListener } from './application/listeners/user-registered.listener';
import { UsersController } from './presentation/controllers/users.controller';

@Module({
  imports: [
    ConfigModule,
    MessagingModule,
    RedisQueueModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL_NOTIFICATION }),
  ],
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY_PORT, useClass: PrismaUserRepository },
    GetUserProfileHandler,
    ListUsersHandler,
    UserRegisteredListener,
  ],
  exports: [USER_REPOSITORY_PORT, ListUsersHandler, GetUserProfileHandler],
})
export class UsersModule {}
