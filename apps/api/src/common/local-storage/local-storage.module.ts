import { Module } from '@nestjs/common';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { LocalStorageController } from './local-storage.controller';

@Module({
  imports: [StorageModule],
  controllers: [LocalStorageController],
})
export class LocalStorageModule {}
