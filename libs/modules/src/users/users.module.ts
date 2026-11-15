import { Module } from '@nestjs/common';
import { USER_REPOSITORY_PORT } from './user-repository.port';
import { PrismaUserRepository } from './prisma-user.repository';
import { GetUserProfileHandler } from './get-user-profile';
import { ListUsersCursorHandler } from './list-users-cursor';
import { UsersListenersModule } from './users-listeners.module';
import { UsersController } from './users.controller';

@Module({
  imports: [UsersListenersModule],
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY_PORT, useClass: PrismaUserRepository },
    GetUserProfileHandler,
    ListUsersCursorHandler,
  ],
})
export class UsersModule {}
