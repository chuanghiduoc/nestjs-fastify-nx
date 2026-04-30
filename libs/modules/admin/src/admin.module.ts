import { Module } from '@nestjs/common';
import { UsersModule } from '@nestjs-fastify-nx/modules-users';
import { AdminUsersController } from './presentation/controllers/admin-users.controller';

@Module({
  imports: [UsersModule],
  controllers: [AdminUsersController],
})
export class AdminModule {}
