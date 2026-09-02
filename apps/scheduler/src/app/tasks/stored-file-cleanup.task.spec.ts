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
  head?: ReturnType<typeof vi.fn>;
}) {
  const prisma = {
    db: {
      $queryRaw: opts?.queryRaw ?? vi.fn().mockResolvedValue([]),
      storedFile: {
        updateMany: vi.fn().mockResolvedValue({ count: opts?.claimed ?? 1 }),
        delete: vi.fn().mockResolvedValue(makeCandidate()),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
  } as unknown as PrismaService;
  // Default: object absent (HEAD → null) so FINALIZING/VERIFYING candidates proceed down the delete path.
  const storage = {
    delete: vi.fn().mockResolvedValue(undefined),
    head: opts?.head ?? vi.fn().mockResolvedValue(null),
  } as unknown as StoragePort;
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

    it('deletes a stale FINALIZING row instead of publishing it without async verification', async () => {
      const candidate = makeCandidate({ status: 'FINALIZING' });
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([]) // REJECTED
        .mockResolvedValueOnce([candidate]) // FINALIZING (stale)
        .mockResolvedValueOnce([]); // VERIFYING (stale)
      const head = vi
        .fn()
        .mockResolvedValue({ contentType: 'image/png', size: 10, bucket: 'uploads', etag: 'e' });
      const { task, prisma, storage } = buildTask({ queryRaw, head });

      await task.cleanup();

      expect(storage.head).toHaveBeenCalledWith('files/user/file.png', 'uploads');
      expect(storage.delete).toHaveBeenCalledWith('files/user/file.png', 'uploads');
      expect(prisma.db.storedFile.delete).toHaveBeenCalled();
      expect(prisma.db.storedFile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
    });

    it('skips deletion when the HEAD check itself fails (never delete a possibly-live object)', async () => {
      const candidate = makeCandidate({ status: 'VERIFYING' });
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([candidate]);
      const head = vi.fn().mockRejectedValue(new Error('S3 timeout'));
      const { task, storage, prisma } = buildTask({ queryRaw, head });

      await expect(task.cleanup()).resolves.toBeUndefined();

      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.db.storedFile.delete).not.toHaveBeenCalled();
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

    it('continues with the remaining candidates and scans when a claim update fails', async () => {
      const first = makeCandidate({ id: '019dd1a7-443a-7dd2-a546-2169d81d7001', key: 'a.png' });
      const second = makeCandidate({ id: '019dd1a7-443a-7dd2-a546-2169d81d7002', key: 'b.png' });
      const third = makeCandidate({ id: '019dd1a7-443a-7dd2-a546-2169d81d7003', key: 'c.png' });
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([]) // REJECTED
        .mockResolvedValueOnce([first, second]) // FINALIZING (stale)
        .mockResolvedValueOnce([third]); // VERIFYING (stale)
      const { task, prisma, storage } = buildTask({ queryRaw });
      (prisma.db.storedFile.updateMany as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValue({ count: 1 });

      await expect(task.cleanup()).resolves.toBeUndefined();

      expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(3);
      expect(storage.delete).not.toHaveBeenCalledWith('a.png', 'uploads');
      expect(storage.delete).toHaveBeenCalledWith('b.png', 'uploads');
      expect(storage.delete).toHaveBeenCalledWith('c.png', 'uploads');
    });

    it('keeps the row when the object delete fails after the claim', async () => {
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeCandidate()]);
      const { task, prisma, storage } = buildTask({ queryRaw });
      (storage.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('s3 down'));

      await expect(task.cleanup()).resolves.toBeUndefined();

      expect(prisma.db.storedFile.delete).not.toHaveBeenCalled();
    });

    it('bounds the REJECTED scan by a retention cutoff like every other scan', async () => {
      const queryRaw = vi.fn().mockResolvedValue([]);
      const { task } = buildTask({ queryRaw });

      await task.cleanup();

      const [, rejectedCutoff] = queryRaw.mock.calls[0] as [unknown, Date];
      expect(rejectedCutoff).toBeInstanceOf(Date);
      expect(Date.now() - rejectedCutoff.getTime()).toBeGreaterThanOrEqual(72 * 3_600_000 - 5_000);
    });
  });

  describe('cleanupOrphaned', () => {
    it('claims and deletes a row whose owning user no longer exists', async () => {
      const candidate = makeCandidate({ status: 'READY' });
      const queryRaw = vi.fn().mockResolvedValue([candidate]);
      const { task, prisma, storage } = buildTask({ queryRaw });

      await task.cleanupOrphaned();

      expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(2);
      expect(storage.delete).toHaveBeenCalledTimes(2);
      expect(prisma.db.storedFile.delete).toHaveBeenCalledTimes(2);
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

  describe('purgeSoftDeleted', () => {
    // Deleting the row first would drop the only pointer to the object and leak it forever,
    // so the order of these two calls is the whole point of the job.
    it('releases the object before dropping the row', async () => {
      const candidate = makeCandidate({ status: 'READY' });
      const queryRaw = vi.fn().mockResolvedValue([candidate]);
      const { task, prisma, storage } = buildTask({ queryRaw });
      const order: string[] = [];
      (storage.delete as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push('storage');
      });
      (prisma.db.storedFile.deleteMany as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push('row');
        return { count: 1 };
      });

      await task.purgeSoftDeleted();

      expect(order).toEqual(['storage', 'row']);
      expect(storage.delete).toHaveBeenCalledWith('files/user/file.png', 'uploads');
    });

    it('keeps the row when the object delete fails so the next run retries', async () => {
      const queryRaw = vi.fn().mockResolvedValue([makeCandidate({ status: 'READY' })]);
      const { task, prisma, storage } = buildTask({ queryRaw });
      (storage.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('s3 down'));

      await expect(task.purgeSoftDeleted()).resolves.toBeUndefined();

      expect(prisma.db.storedFile.deleteMany).not.toHaveBeenCalled();
    });

    it('does nothing on a follower replica', async () => {
      const { task, prisma } = buildTask({ leader: false });

      await task.purgeSoftDeleted();

      expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
    });

    it('does not throw when the scan fails', async () => {
      const queryRaw = vi.fn().mockRejectedValue(new Error('scan failed'));
      const { task } = buildTask({ queryRaw });

      await expect(task.purgeSoftDeleted()).resolves.toBeUndefined();
    });

    it('keeps draining while a full batch comes back', async () => {
      const fullPage = Array.from({ length: 500 }, (_, i) => ({
        id: `019dd1a7-443a-7dd2-a546-2169d81d7${String(i).padStart(3, '0')}`,
        key: `files/user/file-${i}.png`,
        bucket: 'uploads',
      }));
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce(fullPage)
        .mockResolvedValueOnce([{ id: 'tail', key: 'files/user/tail.png', bucket: 'uploads' }]);
      const { task, prisma, storage } = buildTask({ queryRaw });

      await task.purgeSoftDeleted();

      expect(queryRaw).toHaveBeenCalledTimes(2);
      expect(storage.delete).toHaveBeenCalledTimes(501);
      expect(prisma.db.storedFile.deleteMany).toHaveBeenCalledTimes(501);
    });

    it('stops the run when a whole batch fails so it cannot spin on the same rows', async () => {
      const fullPage = Array.from({ length: 500 }, (_, i) => ({
        id: `019dd1a7-443a-7dd2-a546-2169d81d7${String(i).padStart(3, '0')}`,
        key: `files/user/file-${i}.png`,
        bucket: 'uploads',
      }));
      const queryRaw = vi.fn().mockResolvedValue(fullPage);
      const { task, storage } = buildTask({ queryRaw });
      (storage.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('s3 down'));

      await expect(task.purgeSoftDeleted()).resolves.toBeUndefined();

      expect(queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
