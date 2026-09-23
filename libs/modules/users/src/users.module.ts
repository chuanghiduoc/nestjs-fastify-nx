import { Module } from '@nestjs/common';
import { USER_REPOSITORY_PORT } from './domain/ports/user-repository.port';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository';
import { GetUserProfileHandler } from './application/queries/get-user-profile/get-user-profile.handler';
import { ListUsersCursorHandler } from './application/queries/list-users-cursor/list-users-cursor.handler';
import { UsersListenersModule } from './users-listeners.module';
import { UsersController } from './presentation/controllers/users.controller';

@Module({
  imports: [UsersListenersModule],
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY_PORT, useClass: PrismaUserRepository },
    // Query handlers are registered with the global QueryBus by CqrsModule's explorer;
    // consumers dispatch via QueryBus, so they no longer need to be exported for direct DI.
    GetUserProfileHandler,
    ListUsersCursorHandler,
  ],
})
export class UsersModule {}
