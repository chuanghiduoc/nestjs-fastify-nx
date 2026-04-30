import { Module } from '@nestjs/common';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { UsersModule } from '@nestjs-fastify-nx/modules-users';
import { UploadController } from './upload.controller';

@Module({
  imports: [StorageModule, UsersModule],
  controllers: [UploadController],
})
export class UploadModule {}
