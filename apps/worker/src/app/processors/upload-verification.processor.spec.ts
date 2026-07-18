import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { StoragePort } from '@nestjs-fastify-nx/infra-storage';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { UploadVerificationProcessor } from './upload-verification.processor';
import type { UploadVerificationPayload } from './upload-verification.processor';

// Magic-byte prefixes from libs/shared/src/lib/file-signature.ts. Padding the
// rest to 16 bytes mimics what `storage.readRange(key, 16, bucket)` returns
// from S3 — no signature lookups read beyond byte 16.
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const UNKNOWN_BLOB = Buffer.from('plain text not a binary file----'.slice(0, 16));

function makeJob(data: UploadVerificationPayload): Job<UploadVerificationPayload> {
  return { id: '1', data } as unknown as Job<UploadVerificationPayload>;
}

function makeStorage(readResult: Buffer | Uint8Array | Error): StoragePort {
  const readRange =
    readResult instanceof Error
      ? vi.fn().mockRejectedValue(readResult)
      : vi.fn().mockResolvedValue(readResult);
  return {
    readRange,
    delete: vi.fn().mockResolvedValue(undefined),
    presignPut: vi.fn(),
    head: vi.fn(),
    commit: vi.fn(),
  } as unknown as StoragePort;
}

function makePrisma(): PrismaService {
  return {
    db: {
      storedFile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    },
  } as unknown as PrismaService;
}

describe('UploadVerificationProcessor', () => {
  let processor: UploadVerificationProcessor;
  let prisma: PrismaService;

  beforeEach(() => {
    vi.restoreAllMocks();
    prisma = makePrisma();
  });

  it('does not delete when magic bytes match declared MIME', async () => {
    const storage = makeStorage(PNG_HEADER);
    processor = new UploadVerificationProcessor(storage, prisma);
    await processor.process(
      makeJob({ key: 'uploads/img.png', declaredContentType: 'image/png', bucket: 'b' }),
    );
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.readRange).toHaveBeenCalledWith('uploads/img.png', 16, 'b');
    expect(prisma.db.storedFile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'READY' }) }),
    );
  });

  it('deletes the object when declared MIME mismatches detected MIME', async () => {
    const storage = makeStorage(JPEG_HEADER);
    processor = new UploadVerificationProcessor(storage, prisma);
    await processor.process(
      makeJob({ key: 'uploads/tampered.png', declaredContentType: 'image/png', bucket: 'b' }),
    );
    expect(storage.delete).toHaveBeenCalledWith('uploads/tampered.png', 'b');
    expect(prisma.db.storedFile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
  });

  it('deletes the object when magic bytes match no known signature', async () => {
    const storage = makeStorage(UNKNOWN_BLOB);
    processor = new UploadVerificationProcessor(storage, prisma);
    await processor.process(
      makeJob({ key: 'uploads/exec.bin', declaredContentType: 'image/png', bucket: 'b' }),
    );
    expect(storage.delete).toHaveBeenCalledWith('uploads/exec.bin', 'b');
  });

  it('propagates storage.delete errors so BullMQ retries cleanup', async () => {
    const storage = makeStorage(JPEG_HEADER);
    (storage.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('s3 down'));
    processor = new UploadVerificationProcessor(storage, prisma);
    await expect(
      processor.process(
        makeJob({ key: 'uploads/x.png', declaredContentType: 'image/png', bucket: 'b' }),
      ),
    ).rejects.toThrow('s3 down');
  });

  it('lets readRange errors propagate so BullMQ retries the job', async () => {
    const storage = makeStorage(new Error('S3 GetObject returned no readable body'));
    processor = new UploadVerificationProcessor(storage, prisma);
    await expect(
      processor.process(
        makeJob({ key: 'uploads/x.png', declaredContentType: 'image/png', bucket: 'b' }),
      ),
    ).rejects.toThrow(/S3 GetObject/);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('accepts a Uint8Array (not just Buffer) from storage.readRange', async () => {
    const storage = makeStorage(new Uint8Array(PNG_HEADER));
    processor = new UploadVerificationProcessor(storage, prisma);
    await processor.process(
      makeJob({ key: 'uploads/img.png', declaredContentType: 'image/png', bucket: 'b' }),
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('does not delete when the record is no longer VERIFYING (already processed by another execution)', async () => {
    const storage = makeStorage(JPEG_HEADER);
    prisma = {
      db: {
        storedFile: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      },
    } as unknown as PrismaService;
    processor = new UploadVerificationProcessor(storage, prisma);

    await processor.process(
      makeJob({ key: 'uploads/tampered.png', declaredContentType: 'image/png', bucket: 'b' }),
    );

    expect(prisma.db.storedFile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'uploads/tampered.png', status: 'VERIFYING' },
      }),
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
