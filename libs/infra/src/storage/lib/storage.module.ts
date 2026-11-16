import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { STORAGE_PORT, type StoragePort } from './storage.port';

export const STORAGE_DRIVERS = ['s3', 'local'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export function resolveStorageDriver(config: ConfigService): StorageDriver {
  const configured = config.get<string>('STORAGE_DRIVER') || 's3';
  if (!STORAGE_DRIVERS.includes(configured as StorageDriver)) {
    throw new Error(`StorageModule: STORAGE_DRIVER must be one of ${STORAGE_DRIVERS.join(', ')}`);
  }
  return configured as StorageDriver;
}

function createStorage(config: ConfigService): StoragePort {
  const driver = resolveStorageDriver(config);
  switch (driver) {
    case 's3':
      return new S3StorageAdapter(config);
    case 'local':
      return new LocalStorageAdapter(config);
    default: {
      const unreachable: never = driver;
      throw new Error(`Unsupported storage driver ${String(unreachable)}`);
    }
  }
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_PORT,
      inject: [ConfigService],
      useFactory: createStorage,
    },
  ],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
