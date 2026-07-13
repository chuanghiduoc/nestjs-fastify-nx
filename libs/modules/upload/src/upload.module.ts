import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { UploadController } from './presentation/controllers/upload.controller';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.UPLOAD_VERIFICATION }),
  ],
  controllers: [UploadController],
})
export class UploadModule {}
