import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { StoredFileCleanupTask } from './stored-file-cleanup.task';
import type { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

function buildTask(opts?: { leader?: boolean; claimed?: number }) {
  const candidate = {
    id: '019dd1a7-443a-7dd2-a546-2169d81d796a',
    key: 'files/user/file.png',
    bucket: 'uploads',
    status: 'VERIFYING',
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
  const prisma = {
    db: {
      $queryRaw: vi.fn().mockResolvedValue([candidate]),
      storedFile: {
        updateMany: vi.fn().mockResolvedValue({ count: opts?.claimed ?? 1 }),
        delete: vi.fn().mockResolvedValue(candidate),
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
  it('claims a stale row before deleting its object and record', async () => {
    const { task, prisma, storage } = buildTask();

    await task.cleanup();

    expect(prisma.db.storedFile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
    expect(storage.delete).toHaveBeenCalledWith('files/user/file.png', 'uploads');
    expect(prisma.db.storedFile.delete).toHaveBeenCalled();
  });

  it('does not delete when another process changed the row before it was claimed', async () => {
    const { task, storage, prisma } = buildTask({ claimed: 0 });

    await task.cleanup();

    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.db.storedFile.delete).not.toHaveBeenCalled();
  });

  it('does nothing on a follower replica', async () => {
    const { task, prisma } = buildTask({ leader: false });

    await task.cleanup();

    expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
  });
});
