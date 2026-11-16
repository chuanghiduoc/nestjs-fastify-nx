import { Module } from '@nestjs/common';
import { USER_REPOSITORY_PORT } from './domain/ports/user-repository.port';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository';
import { GetUserProfileHandler } from './application/queries/get-user-profile';
import { ListUsersCursorHandler } from './application/queries/list-users-cursor';
import { UsersListenersModule } from './users-listeners.module';
import { UsersController } from './presentation/controllers/users.controller';

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
