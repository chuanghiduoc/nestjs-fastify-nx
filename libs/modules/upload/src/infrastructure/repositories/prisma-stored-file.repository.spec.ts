import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PrismaStoredFileRepository } from './prisma-stored-file.repository';

function build(overrides: Partial<Record<string, Mock>> = {}) {
  const storedFile = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    ...overrides,
  };
  const prisma = {
    db: { storedFile },
    dbRead: { storedFile },
    currentTransaction: undefined,
  } as unknown as PrismaService;
  return { repository: new PrismaStoredFileRepository(prisma), storedFile };
}

describe('PrismaStoredFileRepository — compare-and-set', () => {
  // The CAS is what makes a duplicate confirm or a retried verify job a no-op instead of a second
  // side effect: the update must be scoped to the status the caller believed the row was in.
  it('scopes a transition to the expected source status and reports whether it won', async () => {
    const { repository, storedFile } = build();

    await expect(
      repository.transition('f1', STORED_FILE_STATUS.FINALIZING, STORED_FILE_STATUS.VERIFYING),
    ).resolves.toBe(true);
    expect(storedFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: STORED_FILE_STATUS.FINALIZING, deletedAt: null },
      data: { status: STORED_FILE_STATUS.VERIFYING },
    });
  });

  it('reports a lost race rather than throwing', async () => {
    const { repository, storedFile } = build({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    });

    await expect(
      repository.transitionByKey('k', STORED_FILE_STATUS.VERIFYING, STORED_FILE_STATUS.READY),
    ).resolves.toBe(false);
    expect(storedFile.updateMany).toHaveBeenCalledOnce();
  });

  it('carries verifiedAt and failureReason through a transition', async () => {
    const { repository, storedFile } = build();
    const verifiedAt = new Date('2026-01-01T00:00:00.000Z');

    await repository.transitionByKey('k', STORED_FILE_STATUS.VERIFYING, STORED_FILE_STATUS.READY, {
      verifiedAt,
      failureReason: null,
    });

    expect(storedFile.updateMany).toHaveBeenCalledWith({
      where: { key: 'k', status: STORED_FILE_STATUS.VERIFYING, deletedAt: null },
      data: { status: STORED_FILE_STATUS.READY, verifiedAt, failureReason: null },
    });
  });

  it('allows transition to REJECTED even if the record was soft-deleted to ensure infected files are purged', async () => {
    const { repository, storedFile } = build();

    await repository.transitionByKey(
      'k',
      STORED_FILE_STATUS.VERIFYING,
      STORED_FILE_STATUS.REJECTED,
      {
        failureReason: 'Malware detected',
      },
    );

    expect(storedFile.updateMany).toHaveBeenCalledWith({
      where: { key: 'k', status: STORED_FILE_STATUS.VERIFYING },
      data: { status: STORED_FILE_STATUS.REJECTED, failureReason: 'Malware detected' },
    });
  });

  // Deleting by id alone would remove a row another execution had already moved on from.
  it('deletes only while the row still holds the expected status', async () => {
    const { repository, storedFile } = build();

    await repository.deleteIfStatus('f1', STORED_FILE_STATUS.FINALIZING);

    expect(storedFile.deleteMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: STORED_FILE_STATUS.FINALIZING },
    });
  });

  // A second DELETE must not restamp deletedAt: that would silently extend the retention window
  // and push the hard purge further out every time the caller retried.
  it('soft-deletes only a live row and reports a lost race', async () => {
    const { repository, storedFile } = build();

    await expect(repository.softDelete('f1')).resolves.toBe(true);

    expect(storedFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });

    const lost = build({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) });
    await expect(lost.repository.softDelete('f1')).resolves.toBe(false);
  });

  it('hides soft-deleted rows from every read path', async () => {
    const { repository, storedFile } = build();

    await repository.findBySourceKey('uploads/u/f.png');
    await repository.findByKey('files/u/f.png');
    await repository.findById('f1');

    for (const call of storedFile.findFirst.mock.calls) {
      expect(call[0].where).toMatchObject({ deletedAt: null });
    }
    expect(storedFile.findFirst).toHaveBeenCalledTimes(3);
  });
});

describe('PrismaStoredFileRepository — client selection', () => {
  it('reads through the open transaction when one is active so uncommitted writes are visible', async () => {
    const txStoredFile = { findFirst: vi.fn().mockResolvedValue(null) };
    const outside = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = {
      db: { storedFile: outside },
      dbRead: { storedFile: outside },
      currentTransaction: { storedFile: txStoredFile },
    } as unknown as PrismaService;

    await new PrismaStoredFileRepository(prisma).findBySourceKey('uploads/u/f.png');

    expect(txStoredFile.findFirst).toHaveBeenCalledOnce();
    expect(outside.findFirst).not.toHaveBeenCalled();
  });
});
