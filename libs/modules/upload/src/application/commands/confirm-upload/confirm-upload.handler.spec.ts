import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { isDomainException } from '@nestjs-fastify-nx/core';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import type { ObjectMetadata, StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { StoredFile, type StoredFileProps } from '../../../domain/entities/stored-file.entity';
import type { StoredFileRepositoryPort } from '../../../domain/ports/stored-file-repository.port';
import type { UploadVerificationDispatcher } from '../../ports/upload-verification.dispatcher';
import type { UploadLimits } from '../../upload-limits';
import { ConfirmUploadCommand } from './confirm-upload.command';
import { ConfirmUploadHandler } from './confirm-upload.handler';

const USER_ID = '019dd1a5-9235-70db-8d57-54ef901d8185';
const OTHER_USER_ID = '019dd1a5-9235-70db-8d57-54ef901d8186';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff]);
const SOURCE_KEY = `uploads/${USER_ID}/019dd1a6-102a-7b25-a5a3-54b298b81864.png`;

const LIMITS: UploadLimits = {
  maxFileBytes: MAX_FILE_SIZE,
  presignExpiresSeconds: 300,
  magicByteCount: 16,
};

function storageMock(): Record<keyof StoragePort, Mock> {
  return {
    upload: vi.fn(),
    presignUpload: vi.fn(),
    head: vi.fn(),
    getSignedUrl: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
    readRange: vi.fn().mockResolvedValue(PNG_HEADER),
    read: vi.fn(),
  };
}

function repositoryMock(): Record<keyof StoredFileRepositoryPort, Mock> {
  return {
    findBySourceKey: vi.fn().mockResolvedValue(null),
    findByKey: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
    transition: vi.fn().mockResolvedValue(true),
    transitionByKey: vi.fn().mockResolvedValue(true),
    deleteIfStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function build() {
  const storage = storageMock();
  const files = repositoryMock();
  const verification: { dispatch: Mock } = { dispatch: vi.fn().mockResolvedValue(undefined) };
  const handler = new ConfirmUploadHandler(
    storage as unknown as StoragePort,
    files as unknown as StoredFileRepositoryPort,
    verification as unknown as UploadVerificationDispatcher,
    LIMITS,
  );
  return { handler, storage, files, verification };
}

function validMeta(overrides: Partial<ObjectMetadata> = {}): ObjectMetadata {
  return {
    contentType: 'image/png',
    size: PNG_HEADER.length,
    bucket: 'uploads',
    etag: '"etag-1"',
    ...overrides,
  };
}

function existingRecord(overrides: Partial<StoredFileProps> = {}): StoredFile {
  return StoredFile.create({
    id: 'file-1',
    userId: USER_ID,
    sourceKey: SOURCE_KEY,
    key: `files/${USER_ID}/file-1.png`,
    bucket: 'uploads',
    contentType: 'image/png',
    size: PNG_HEADER.length,
    etag: '"etag-1"',
    status: STORED_FILE_STATUS.VERIFYING,
    ...overrides,
  });
}

const command = (key = SOURCE_KEY, userId = USER_ID) =>
  new ConfirmUploadCommand(userId, key, 'corr-1');

describe('ConfirmUploadHandler — ownership (IDOR)', () => {
  it('rejects a key outside the caller prefix without touching storage or the repository', async () => {
    const { handler, storage, files } = build();

    await expect(handler.execute(command(`uploads/${OTHER_USER_ID}/x.png`))).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(storage.head).not.toHaveBeenCalled();
    expect(files.findBySourceKey).not.toHaveBeenCalled();
  });
});

describe('ConfirmUploadHandler — staged object validation', () => {
  it('rejects and deletes an object whose Content-Type is not allow-listed', async () => {
    const { handler, storage } = build();
    storage.head.mockResolvedValue(validMeta({ contentType: 'application/x-msdownload' }));

    await expect(handler.execute(command())).rejects.toMatchObject({
      kind: 'validation',
      code: 'upload_mime_not_allowed',
    });
    expect(storage.delete).toHaveBeenCalledWith(SOURCE_KEY);
  });

  it.each([
    ['exceeds the cap', MAX_FILE_SIZE + 1],
    ['is zero bytes', 0],
  ])('rejects and deletes an object whose size %s', async (_label, size) => {
    const { handler, storage } = build();
    storage.head.mockResolvedValue(validMeta({ size }));

    await expect(handler.execute(command())).rejects.toMatchObject({
      code: 'upload_size_out_of_range',
    });
    expect(storage.delete).toHaveBeenCalledWith(SOURCE_KEY);
  });

  it('rejects and deletes an object whose signature disagrees with its declared type', async () => {
    const { handler, storage, verification } = build();
    storage.head.mockResolvedValue(validMeta());
    storage.readRange.mockResolvedValue(JPEG_HEADER);

    await expect(handler.execute(command())).rejects.toMatchObject({
      code: 'upload_magic_bytes_mismatch',
    });
    expect(storage.delete).toHaveBeenCalledWith(SOURCE_KEY);
    expect(verification.dispatch).not.toHaveBeenCalled();
  });

  it('rejects an object with no recognized signature', async () => {
    const { handler, storage } = build();
    storage.head.mockResolvedValue(validMeta());
    storage.readRange.mockResolvedValue(Buffer.from([0x00, 0x01, 0x02, 0x03]));

    await expect(handler.execute(command())).rejects.toMatchObject({
      code: 'upload_magic_bytes_unknown',
    });
    expect(storage.delete).toHaveBeenCalledWith(SOURCE_KEY);
  });

  it('reports a missing staged object as not found', async () => {
    const { handler, storage } = build();
    storage.head.mockResolvedValue(null);

    await expect(handler.execute(command())).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('ConfirmUploadHandler — happy path', () => {
  it('finalizes to an immutable key, moves to VERIFYING and dispatches verification', async () => {
    const { handler, storage, files, verification } = build();
    storage.head.mockResolvedValue(validMeta());

    const result = await handler.execute(command());

    expect(result.key).toMatch(new RegExp(`^files/${USER_ID}/[0-9a-f-]+\\.png$`));
    // The ETag precondition is what binds the copy to the exact version that was validated.
    expect(storage.finalize).toHaveBeenCalledWith(SOURCE_KEY, result.key, '"etag-1"', 'uploads');
    expect(files.transition).toHaveBeenCalledWith(
      expect.any(String),
      STORED_FILE_STATUS.FINALIZING,
      STORED_FILE_STATUS.VERIFYING,
    );
    expect(verification.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ key: result.key, declaredContentType: 'image/png' }),
    );
    // Quarantined until the worker clears it.
    expect(result.url).toBeUndefined();
  });
});

describe('ConfirmUploadHandler — concurrency and recovery', () => {
  it('recovers through the existing row when a duplicate sourceKey races the insert', async () => {
    const { handler, storage, files } = build();
    storage.head.mockResolvedValueOnce(validMeta()).mockResolvedValue(validMeta());
    files.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    files.findBySourceKey.mockResolvedValueOnce(null).mockResolvedValue(existingRecord());

    const result = await handler.execute(command());

    expect(result.key).toBe(`files/${USER_ID}/file-1.png`);
    expect(storage.finalize).not.toHaveBeenCalled();
  });

  it('re-throws a create failure that is not a unique-constraint race', async () => {
    const { handler, storage, files } = build();
    storage.head.mockResolvedValue(validMeta());
    files.create.mockRejectedValue(Object.assign(new Error('boom'), { code: 'P2000' }));

    await expect(handler.execute(command())).rejects.toThrow('boom');
  });

  it('answers 409-retryable while a concurrent confirm has not published the object yet', async () => {
    const { handler, storage, files } = build();
    files.findBySourceKey.mockResolvedValue(
      existingRecord({ status: STORED_FILE_STATUS.FINALIZING }),
    );
    storage.head.mockResolvedValue(null);

    const error = await handler.execute(command()).catch((e: unknown) => e);

    expect(isDomainException(error) && error.kind).toBe('conflict');
    // A retry can win this one, so consumers that retry must not park it.
    expect(isDomainException(error) && error.permanent).toBe(false);
  });

  it('replays the persisted record for an already-confirmed sourceKey', async () => {
    const { handler, storage, files, verification } = build();
    files.findBySourceKey.mockResolvedValue(existingRecord({ status: STORED_FILE_STATUS.READY }));
    storage.head.mockResolvedValue(validMeta());
    storage.getSignedUrl.mockResolvedValue('https://signed.example/file');

    const result = await handler.execute(command());

    expect(result.url).toBe('https://signed.example/file');
    expect(storage.finalize).not.toHaveBeenCalled();
    // READY is out of quarantine, so no re-verification is queued.
    expect(verification.dispatch).not.toHaveBeenCalled();
  });

  it('treats an existing REJECTED row as not found', async () => {
    const { handler, files } = build();
    files.findBySourceKey.mockResolvedValue(
      existingRecord({ status: STORED_FILE_STATUS.REJECTED }),
    );

    await expect(handler.execute(command())).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('ConfirmUploadHandler — finalize failure', () => {
  it('rolls the FINALIZING row back and never queues verification', async () => {
    const { handler, storage, files, verification } = build();
    storage.head.mockResolvedValue(validMeta());
    storage.finalize.mockRejectedValue(new Error('s3 down'));

    // Infrastructure faults stay generic 5xx errors, not client-correctable domain failures.
    const error = await handler.execute(command()).catch((e: unknown) => e);
    expect(isDomainException(error)).toBe(false);

    expect(files.deleteIfStatus).toHaveBeenCalledWith(
      expect.any(String),
      STORED_FILE_STATUS.FINALIZING,
    );
    expect(verification.dispatch).not.toHaveBeenCalled();
  });

  it('fails without queueing when the row vanished before the VERIFYING transition', async () => {
    const { handler, storage, files, verification } = build();
    storage.head.mockResolvedValue(validMeta());
    files.transition.mockResolvedValue(false);

    await expect(handler.execute(command())).rejects.toThrow();
    expect(verification.dispatch).not.toHaveBeenCalled();
  });
});
