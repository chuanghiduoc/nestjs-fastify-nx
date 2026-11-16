import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule, type ConfigService } from '@nestjs/config';
import { LocalStorageAdapter } from './local-storage.adapter';
import { StorageModule, resolveStorageDriver } from './storage.module';
import { STORAGE_PORT } from './storage.port';

function configWith(driver: string | undefined): ConfigService {
  return { get: () => driver } as unknown as ConfigService;
}

describe('resolveStorageDriver', () => {
  it('defaults to s3 when no driver is configured', () => {
    expect(resolveStorageDriver(configWith(undefined))).toBe('s3');
  });

  it('accepts the local driver', () => {
    expect(resolveStorageDriver(configWith('local'))).toBe('local');
  });

  it('fails loudly on an unknown driver', () => {
    expect(() => resolveStorageDriver(configWith('ftp'))).toThrow(/STORAGE_DRIVER/);
  });
});

describe('StorageModule', () => {
  it('binds the storage port to the local adapter when STORAGE_DRIVER=local', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_ROOT: 'unused-root' })],
        }),
        StorageModule,
      ],
    }).compile();

    expect(moduleRef.get(STORAGE_PORT)).toBeInstanceOf(LocalStorageAdapter);
    await moduleRef.close();
  });
});
