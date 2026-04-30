import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { S3StorageAdapter } from './s3-storage.adapter';
import { STORAGE_PORT } from './storage.port';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_PORT,
      useClass: S3StorageAdapter,
    },
  ],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
