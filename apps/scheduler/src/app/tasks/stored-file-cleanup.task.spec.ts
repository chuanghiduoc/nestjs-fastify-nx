import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { StoredFileCleanupTask } from './stored-file-cleanup.task';
import type { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

function makeCandidate(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: '019dd1a7-443a-7dd2-a546-2169d81d796a',
    key: 'files/user/file.png',
    bucket: 'uploads',
    status: 'VERIFYING',
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildTask(opts?: {
  leader?: boolean;
  claimed?: number;
  queryRaw?: ReturnType<typeof vi.fn>;
}) {
  const prisma = {
    db: {
      $queryRaw: opts?.queryRaw ?? vi.fn().mockResolvedValue([]),
      storedFile: {
        updateMany: vi.fn().mockResolvedValue({ count: opts?.claimed ?? 1 }),
        delete: vi.fn().mockResolvedValue(makeCandidate()),
      },
    },
  } as unknown as PrismaService;
  const storage = { delete: vi.fn().mockResolvedValue(undefined) } as unknown as StoragePort;
  const leadership = {
    isLeader: vi.fn().mockReturnValue(opts?.leader ?? true),
  } as unknown as SchedulerLeaderService;
  return {
    task: new StoredFileCleanupTask(prisma, storage, leadership),
    prisma,
    storage,
  };
}

describe('StoredFileCleanupTask', () => {
  describe('cleanup', () => {
    it('runs one scan per status and claims a stale row before deleting its object and record', async () => {
      const candidate = makeCandidate();
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([]) // REJECTED
        .mockResolvedValueOnce([]) // FINALIZING (stale)
        .mockResolvedValueOnce([candidate]); // VERIFYING (stale)
      const { task, prisma, storage } = buildTask({ queryRaw });

      await task.cleanup();

      expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(3);
      expect(prisma.db.storedFile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
      expect(storage.delete).toHaveBeenCalledWith('files/user/file.png', 'uploads');
      expect(prisma.db.storedFile.delete).toHaveBeenCalled();
    });

    it('does not delete when another process changed the row before it was claimed', async () => {
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeCandidate()]);
      const { task, storage, prisma } = buildTask({ queryRaw, claimed: 0 });

      await task.cleanup();

      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.db.storedFile.delete).not.toHaveBeenCalled();
    });

    it('does nothing on a follower replica', async () => {
      const { task, prisma } = buildTask({ leader: false });

      await task.cleanup();

      expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
    });

    it('continues to the remaining scans when one status scan fails', async () => {
      const candidate = makeCandidate({ status: 'VERIFYING' });
      const queryRaw = vi
        .fn()
        .mockRejectedValueOnce(new Error('REJECTED scan failed'))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidate]);
      const { task, prisma, storage } = buildTask({ queryRaw });

      await expect(task.cleanup()).resolves.toBeUndefined();

      expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(3);
      expect(storage.delete).toHaveBeenCalledWith('files/user/file.png', 'uploads');
    });
  });

  describe('cleanupOrphaned', () => {
    it('claims and deletes a row whose owning user no longer exists', async () => {
      const candidate = makeCandidate({ status: 'READY' });
      const queryRaw = vi.fn().mockResolvedValue([candidate]);
      const { task, prisma, storage } = buildTask({ queryRaw });

      await task.cleanupOrphaned();

      expect(prisma.db.$queryRaw).toHaveBeenCalledOnce();
      expect(storage.delete).toHaveBeenCalledWith('files/user/file.png', 'uploads');
      expect(prisma.db.storedFile.delete).toHaveBeenCalled();
    });

    it('does nothing on a follower replica', async () => {
      const { task, prisma } = buildTask({ leader: false });

      await task.cleanupOrphaned();

      expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
    });

    it('does not throw when the scan fails', async () => {
      const queryRaw = vi.fn().mockRejectedValue(new Error('scan failed'));
      const { task } = buildTask({ queryRaw });

      await expect(task.cleanupOrphaned()).resolves.toBeUndefined();
    });
  });
});
