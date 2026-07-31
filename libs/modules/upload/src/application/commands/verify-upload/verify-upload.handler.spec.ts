import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import type { StoragePort } from '@nestjs-fastify-nx/infra-storage';
import type { StoredFileRepositoryPort } from '../../../domain/ports/stored-file-repository.port';
import type { MalwareScannerPort } from '../../../domain/ports/malware-scanner.port';
import type { UploadLimits } from '../../upload-limits';
import { VerifyUploadCommand } from './verify-upload.command';
import { VerifyUploadHandler } from './verify-upload.handler';

const KEY = 'files/019dd1a5-9235-70db-8d57-54ef901d8185/file-1.png';
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff]);
const LIMITS: UploadLimits = {
  maxFileBytes: 10 * 1024 * 1024,
  presignExpiresSeconds: 300,
  magicByteCount: 16,
};

function build() {
  const storage: { readRange: Mock; read: Mock; delete: Mock } = {
    readRange: vi.fn().mockResolvedValue(PNG_HEADER),
    read: vi.fn().mockResolvedValue(PNG_HEADER),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const files: { transitionByKey: Mock } = { transitionByKey: vi.fn().mockResolvedValue(true) };
  const scanner = { scan: vi.fn().mockResolvedValue('clean' as const) };
  const handler = new VerifyUploadHandler(
    storage as unknown as StoragePort,
    files as unknown as StoredFileRepositoryPort,
    scanner as unknown as MalwareScannerPort,
    LIMITS,
  );
  return { handler, storage, files, scanner };
}

const command = () => new VerifyUploadCommand(KEY, 'image/png', 'uploads', 'corr-1');

describe('VerifyUploadHandler', () => {
  it('promotes a clean object whose signature matches', async () => {
    const { handler, files, storage } = build();

    await expect(handler.execute(command())).resolves.toBe('verified');
    expect(files.transitionByKey).toHaveBeenCalledWith(
      KEY,
      STORED_FILE_STATUS.VERIFYING,
      STORED_FILE_STATUS.READY,
      expect.objectContaining({ failureReason: null }),
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('rejects and deletes an object whose signature disagrees with its declared type', async () => {
    const { handler, storage, files } = build();
    storage.readRange.mockResolvedValue(JPEG_HEADER);

    await expect(handler.execute(command())).resolves.toBe('rejected');
    expect(files.transitionByKey).toHaveBeenCalledWith(
      KEY,
      STORED_FILE_STATUS.VERIFYING,
      STORED_FILE_STATUS.REJECTED,
      expect.objectContaining({ failureReason: expect.any(String) }),
    );
    expect(storage.delete).toHaveBeenCalledWith(KEY, 'uploads');
  });

  it('rejects and deletes an infected object', async () => {
    const { handler, storage, scanner } = build();
    scanner.scan.mockResolvedValue('infected');

    await expect(handler.execute(command())).resolves.toBe('rejected');
    expect(storage.delete).toHaveBeenCalledWith(KEY, 'uploads');
  });

  // A duplicate or retried job must not delete a file another execution already promoted.
  it('skips without deleting when the row is no longer VERIFYING', async () => {
    const { handler, storage, files } = build();
    storage.readRange.mockResolvedValue(JPEG_HEADER);
    files.transitionByKey.mockResolvedValue(false);

    await expect(handler.execute(command())).resolves.toBe('skipped');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  // A storage adapter may hand back a Uint8Array; the signature table indexes raw bytes.
  it('accepts a Uint8Array from storage.readRange', async () => {
    const { handler, storage } = build();
    storage.readRange.mockResolvedValue(new Uint8Array(PNG_HEADER));

    await expect(handler.execute(command())).resolves.toBe('verified');
  });

  it('lets a readRange failure propagate so BullMQ retries the job', async () => {
    const { handler, storage } = build();
    storage.readRange.mockRejectedValue(new Error('s3 unavailable'));

    await expect(handler.execute(command())).rejects.toThrow('s3 unavailable');
  });

  it('lets a delete failure propagate so cleanup is retried', async () => {
    const { handler, storage } = build();
    storage.readRange.mockResolvedValue(JPEG_HEADER);
    storage.delete.mockRejectedValue(new Error('delete failed'));

    await expect(handler.execute(command())).rejects.toThrow('delete failed');
  });

  it('skips the ready flip when the row was already processed', async () => {
    const { handler, files } = build();
    files.transitionByKey.mockResolvedValue(false);

    await expect(handler.execute(command())).resolves.toBe('skipped');
  });
});
