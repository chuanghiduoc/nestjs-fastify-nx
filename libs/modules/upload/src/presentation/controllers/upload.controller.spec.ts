import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Queue } from 'bullmq';
import type {
  PrismaService,
  StoredFile as StoredFileRecord,
} from '@nestjs-fastify-nx/infra-database';
import type { ObjectMetadata, StoragePort } from '@nestjs-fastify-nx/infra-storage';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import type { ConfirmUploadDto } from '../dto/confirm-upload.dto';
import type { PresignUploadDto } from '../dto/presign-upload.dto';
import { UploadController, verificationJobId } from './upload.controller';

describe('verificationJobId', () => {
  it('is stable for retries and collision-resistant for delimiter variants', () => {
    expect(verificationJobId('users/a/b_c')).toBe(verificationJobId('users/a/b_c'));
    expect(verificationJobId('users/a/b_c')).not.toBe(verificationJobId('users/a_b/c'));
    expect(verificationJobId('users/a/b_c')).toMatch(/^verify__[a-f0-9]{64}$/);
  });
});

const USER_ID = '019dd1a5-9235-70db-8d57-54ef901d8185';
const OTHER_USER_ID = '019dd1a5-9235-70db-8d57-54ef901d8186';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff]);

function createUser(userId = USER_ID): AuthenticatedSession {
  return {
    userId,
    email: 'u@test.com',
    name: 'U',
    role: 'USER',
    status: 'ACTIVE',
    sessionId: 's',
    sessionToken: 't',
  };
}

interface StorageMock {
  upload: Mock;
  presignUpload: Mock;
  head: Mock;
  getSignedUrl: Mock;
  delete: Mock;
  finalize: Mock;
  readRange: Mock;
}

function createStorageMock(): StorageMock {
  return {
    upload: vi.fn(),
    presignUpload: vi.fn(),
    head: vi.fn(),
    getSignedUrl: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn(),
    readRange: vi.fn(),
  };
}

interface PrismaMock {
  db: {
    storedFile: {
      findUnique: Mock;
      create: Mock;
      update: Mock;
      updateMany: Mock;
      deleteMany: Mock;
    };
  };
}

function createPrismaMock(): PrismaMock {
  return {
    db: {
      storedFile: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

function createQueueMock(): { add: Mock } {
  return { add: vi.fn().mockResolvedValue(undefined) };
}

function createController() {
  process.env['UPLOAD_MAX_FILE_BYTES'] = String(MAX_FILE_SIZE);
  process.env['UPLOAD_PRESIGN_EXPIRES_SECONDS'] = '300';
  const storage = createStorageMock();
  const prisma = createPrismaMock();
  const queue = createQueueMock();
  // ClsService stub — no active request context in a unit test, so correlationId resolves to undefined.
  const cls = { get: vi.fn().mockReturnValue(undefined) };
  const controller = new UploadController(
    storage as unknown as StoragePort,
    queue as unknown as Queue,
    prisma as unknown as PrismaService,
    cls as unknown as ConstructorParameters<typeof UploadController>[3],
  );
  return { controller, storage, prisma, queue };
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

describe('UploadController', () => {
  describe('presign', () => {
    it('issues a policy scoped under the caller user id and mirrors size/expiry config', async () => {
      const { controller, storage } = createController();
      const user = createUser();
      const dto: PresignUploadDto = { contentType: 'image/png' };
      const policy = {
        url: 'https://s3.example.com/uploads',
        fields: { key: 'x', 'Content-Type': 'image/png' },
        key: 'stubbed',
        bucket: 'uploads',
        expiresAt: new Date().toISOString(),
        maxBytes: MAX_FILE_SIZE,
      };
      storage.presignUpload.mockResolvedValue(policy);

      const result = await controller.presign(user, dto);

      expect(result).toBe(policy);
      expect(storage.presignUpload).toHaveBeenCalledTimes(1);
      const [key, options] = storage.presignUpload.mock.calls[0];
      expect(key).toMatch(new RegExp(`^uploads/${USER_ID}/[0-9a-f-]{36}\\.png$`));
      expect(options).toEqual({
        contentType: 'image/png',
        maxBytes: MAX_FILE_SIZE,
        expiresInSeconds: 300,
      });
    });

    it('rejects a MIME type outside the allow-list before ever calling storage', async () => {
      const { controller, storage } = createController();
      const user = createUser();
      // Bypasses DTO-level validation to exercise the controller's own defense-in-depth check.
      const dto = { contentType: 'application/x-msdownload' } as PresignUploadDto;

      await expect(controller.presign(user, dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.presignUpload).not.toHaveBeenCalled();
    });
  });

  describe('confirm — ownership (IDOR)', () => {
    it('rejects a key that does not belong to the caller without touching storage or the DB', async () => {
      const { controller, storage, prisma } = createController();
      const user = createUser(USER_ID);
      const dto: ConfirmUploadDto = { key: `uploads/${OTHER_USER_ID}/file.png` };

      await expect(controller.confirm(user, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.db.storedFile.findUnique).not.toHaveBeenCalled();
      expect(storage.head).not.toHaveBeenCalled();
    });
  });

  describe('confirm — MIME rejection', () => {
    it('rejects and deletes the object when the actual Content-Type is not allow-listed', async () => {
      const { controller, storage, prisma } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.exe`;
      const dto: ConfirmUploadDto = { key };
      storage.head.mockResolvedValue(validMeta({ contentType: 'application/x-msdownload' }));

      const err = await controller.confirm(user, dto).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        messageKey: 'errors.upload.mime_not_allowed',
      });
      expect(storage.delete).toHaveBeenCalledWith(key);
      expect(prisma.db.storedFile.create).not.toHaveBeenCalled();
    });
  });

  describe('confirm — size rejection', () => {
    it('rejects and deletes the object when size exceeds the configured cap', async () => {
      const { controller, storage, prisma } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      storage.head.mockResolvedValue(validMeta({ size: MAX_FILE_SIZE + 1 }));

      const err = await controller.confirm(user, dto).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        messageKey: 'errors.upload.size_out_of_range',
      });
      expect(storage.delete).toHaveBeenCalledWith(key);
      expect(prisma.db.storedFile.create).not.toHaveBeenCalled();
    });

    it('rejects a zero-byte object', async () => {
      const { controller, storage } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      storage.head.mockResolvedValue(validMeta({ size: 0 }));

      const err = await controller.confirm(user, dto).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        messageKey: 'errors.upload.size_out_of_range',
      });
    });
  });

  describe('confirm — magic-byte rejection', () => {
    it('rejects and deletes the object when the binary signature disagrees with the declared Content-Type', async () => {
      const { controller, storage, prisma } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      storage.head.mockResolvedValue(
        validMeta({ contentType: 'image/png', size: JPEG_HEADER.length }),
      );
      // Declares PNG but the bytes on the wire are a JPEG signature — must be caught even though
      // both are allow-listed types individually.
      storage.readRange.mockResolvedValue(JPEG_HEADER);

      const err = await controller.confirm(user, dto).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        messageKey: 'errors.upload.magic_bytes_mismatch',
        args: { detected: 'image/jpeg', declared: 'image/png' },
      });
      expect(storage.delete).toHaveBeenCalledWith(key);
      expect(prisma.db.storedFile.create).not.toHaveBeenCalled();
    });

    it('rejects an object with no recognized binary signature', async () => {
      const { controller, storage } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      storage.head.mockResolvedValue(validMeta());
      storage.readRange.mockResolvedValue(Buffer.from([0x00, 0x00, 0x00, 0x00]));

      const err = await controller.confirm(user, dto).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        messageKey: 'errors.upload.magic_bytes_unknown',
      });
    });
  });

  describe('confirm — P2002 concurrent-confirm recovery', () => {
    it('recovers via the existing row when a duplicate sourceKey insert races the create', async () => {
      const { controller, storage, prisma, queue } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      const concurrentRecord: StoredFileRecord = {
        id: 'existing-id',
        userId: USER_ID,
        sourceKey: key,
        key: `files/${USER_ID}/existing-id.png`,
        bucket: 'uploads',
        contentType: 'image/png',
        size: PNG_HEADER.length,
        etag: '"etag-1"',
        status: STORED_FILE_STATUS.VERIFYING,
      } as StoredFileRecord;

      prisma.db.storedFile.findUnique
        .mockResolvedValueOnce(null) // no existing row before the create attempt
        .mockResolvedValueOnce(concurrentRecord); // raced insert found on P2002 retry
      storage.head
        .mockResolvedValueOnce(validMeta()) // meta lookup for the staged object
        .mockResolvedValueOnce(validMeta({ bucket: concurrentRecord.bucket })); // recoverExisting() re-check
      storage.readRange.mockResolvedValue(PNG_HEADER);
      prisma.db.storedFile.create.mockRejectedValue({ code: 'P2002' });
      storage.getSignedUrl.mockResolvedValue(`http://signed/${concurrentRecord.key}`);

      const result = await controller.confirm(user, dto);

      expect(result).toEqual({
        key: concurrentRecord.key,
        url: `http://signed/${concurrentRecord.key}`,
        bucket: concurrentRecord.bucket,
        size: concurrentRecord.size,
      });
      // Status was already VERIFYING (not FINALIZING), so no transition update is issued.
      expect(prisma.db.storedFile.updateMany).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        'verify-magic-bytes',
        expect.objectContaining({ key: concurrentRecord.key }),
        expect.objectContaining({ jobId: verificationJobId(concurrentRecord.key) }),
      );
    });

    it('re-throws when the create fails for a reason other than a unique-constraint race', async () => {
      const { controller, storage, prisma } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      storage.head.mockResolvedValue(validMeta());
      storage.readRange.mockResolvedValue(PNG_HEADER);
      const dbError = new Error('connection lost');
      prisma.db.storedFile.create.mockRejectedValue(dbError);

      await expect(controller.confirm(user, dto)).rejects.toBe(dbError);
    });

    it('returns 409 when the concurrent row exists but the final object is not yet visible on storage', async () => {
      const { controller, storage, prisma } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      const concurrentRecord: StoredFileRecord = {
        id: 'existing-id',
        userId: USER_ID,
        sourceKey: key,
        key: `files/${USER_ID}/existing-id.png`,
        bucket: 'uploads',
        contentType: 'image/png',
        size: PNG_HEADER.length,
        etag: '"etag-1"',
        status: STORED_FILE_STATUS.FINALIZING,
      } as StoredFileRecord;

      prisma.db.storedFile.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(concurrentRecord);
      storage.head.mockResolvedValueOnce(validMeta()).mockResolvedValueOnce(null); // finalize has not landed on storage yet
      storage.readRange.mockResolvedValue(PNG_HEADER);
      prisma.db.storedFile.create.mockRejectedValue({ code: 'P2002' });

      await expect(controller.confirm(user, dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('confirm — finalize-failure rollback', () => {
    it('deletes the FINALIZING row and returns 500 without enqueueing verification when finalize() throws', async () => {
      const { controller, storage, prisma, queue } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      storage.head.mockResolvedValue(validMeta());
      storage.readRange.mockResolvedValue(PNG_HEADER);
      storage.getSignedUrl.mockResolvedValue('http://signed/final');
      prisma.db.storedFile.create.mockResolvedValue(undefined);
      storage.finalize.mockRejectedValue(new Error('S3 copy failed'));

      const err = await controller.confirm(user, dto).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect((err as InternalServerErrorException).getResponse()).toMatchObject({
        messageKey: 'errors.upload.commit_failed',
      });
      expect(prisma.db.storedFile.deleteMany).toHaveBeenCalledWith({
        where: { id: expect.any(String), status: STORED_FILE_STATUS.FINALIZING },
      });
      expect(prisma.db.storedFile.update).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('confirm — happy path', () => {
    it('finalizes to an immutable key, transitions to VERIFYING, and enqueues the magic-byte recheck', async () => {
      const { controller, storage, prisma, queue } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      storage.head.mockResolvedValue(validMeta());
      storage.readRange.mockResolvedValue(PNG_HEADER);
      storage.getSignedUrl.mockResolvedValue('http://signed/final');
      prisma.db.storedFile.create.mockResolvedValue(undefined);
      storage.finalize.mockResolvedValue(undefined);

      const result = await controller.confirm(user, dto);

      expect(result.key).toMatch(new RegExp(`^files/${USER_ID}/[0-9a-f-]{36}\\.png$`));
      expect(result).toMatchObject({
        url: 'http://signed/final',
        bucket: 'uploads',
        size: PNG_HEADER.length,
      });

      expect(prisma.db.storedFile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          sourceKey: key,
          key: result.key,
          bucket: 'uploads',
          contentType: 'image/png',
          status: STORED_FILE_STATUS.FINALIZING,
        }),
      });
      expect(storage.finalize).toHaveBeenCalledWith(key, result.key, '"etag-1"', 'uploads');
      expect(prisma.db.storedFile.updateMany).toHaveBeenCalledWith({
        where: { id: expect.any(String), status: STORED_FILE_STATUS.FINALIZING },
        data: { status: STORED_FILE_STATUS.VERIFYING },
      });
      expect(queue.add).toHaveBeenCalledWith(
        'verify-magic-bytes',
        { key: result.key, declaredContentType: 'image/png', bucket: 'uploads' },
        expect.objectContaining({ jobId: verificationJobId(result.key) }),
      );
    });

    it('short-circuits to the persisted record when the sourceKey was already confirmed (idempotent replay)', async () => {
      const { controller, storage, prisma, queue } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      const existing: StoredFileRecord = {
        id: 'already-confirmed',
        userId: USER_ID,
        sourceKey: key,
        key: `files/${USER_ID}/already-confirmed.png`,
        bucket: 'uploads',
        contentType: 'image/png',
        size: PNG_HEADER.length,
        etag: '"etag-1"',
        status: STORED_FILE_STATUS.READY,
      } as StoredFileRecord;
      prisma.db.storedFile.findUnique.mockResolvedValueOnce(existing);
      storage.head.mockResolvedValue(validMeta({ bucket: existing.bucket }));
      storage.getSignedUrl.mockResolvedValue(`http://signed/${existing.key}`);

      const result = await controller.confirm(user, dto);

      expect(result).toEqual({
        key: existing.key,
        url: `http://signed/${existing.key}`,
        bucket: existing.bucket,
        size: existing.size,
      });
      // READY rows are terminal — no re-enqueue, no status transition.
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.db.storedFile.updateMany).not.toHaveBeenCalled();
    });

    it('treats a REJECTED existing row as not found', async () => {
      const { controller, prisma } = createController();
      const user = createUser();
      const key = `uploads/${USER_ID}/file.png`;
      const dto: ConfirmUploadDto = { key };
      const rejected: StoredFileRecord = {
        id: 'rejected-id',
        userId: USER_ID,
        sourceKey: key,
        key: `files/${USER_ID}/rejected-id.png`,
        bucket: 'uploads',
        contentType: 'image/png',
        size: PNG_HEADER.length,
        etag: '"etag-1"',
        status: STORED_FILE_STATUS.REJECTED,
      } as StoredFileRecord;
      prisma.db.storedFile.findUnique.mockResolvedValueOnce(rejected);

      await expect(controller.confirm(user, dto)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
