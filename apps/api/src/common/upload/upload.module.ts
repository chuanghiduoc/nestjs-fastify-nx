import { Module } from '@nestjs/common';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { UploadController } from './upload.controller';

@Module({
  imports: [StorageModule],
  controllers: [UploadController],
})
export class UploadModule {}
