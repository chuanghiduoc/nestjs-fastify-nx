import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CleanupTask } from './cleanup.task';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

/** Minimal PrismaService mock that covers the methods used by CleanupTask. */
function makePrismaMock() {
  return {
    db: {
      user: {
        deleteMany: vi.fn(),
      },
      $executeRaw: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('CleanupTask', () => {
  let task: CleanupTask;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    task = new CleanupTask(prisma);
  });

  // ── purgeInactiveUsers ──────────────────────────────────────────────────────

  describe('purgeInactiveUsers', () => {
    it('calls deleteMany with status INACTIVE and updatedAt less than the 90-day cutoff', async () => {
      vi.mocked(prisma.db.user.deleteMany).mockResolvedValue({ count: 3 });

      const before = new Date();
      await task.purgeInactiveUsers();
      const after = new Date();

      expect(prisma.db.user.deleteMany).toHaveBeenCalledOnce();

      const [callArgs] = vi.mocked(prisma.db.user.deleteMany).mock.calls;
      const { where } = callArgs[0] as {
        where: { status: string; updatedAt: { lt: Date } };
      };

      expect(where.status).toBe('INACTIVE');
      expect(where.updatedAt.lt).toBeInstanceOf(Date);

      // The cutoff must be ~90 days before now (allow ±1 second for test timing)
      const expectedMin = new Date(before.getTime() - 90 * 24 * 60 * 60 * 1_000 - 1_000);
      const expectedMax = new Date(after.getTime() - 90 * 24 * 60 * 60 * 1_000 + 1_000);
      expect(where.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(where.updatedAt.lt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });

    it('does not throw when deleteMany succeeds', async () => {
      vi.mocked(prisma.db.user.deleteMany).mockResolvedValue({ count: 0 });

      await expect(task.purgeInactiveUsers()).resolves.toBeUndefined();
    });

    it('does not throw when deleteMany fails (error is only logged)', async () => {
      vi.mocked(prisma.db.user.deleteMany).mockRejectedValue(new Error('DB connection lost'));

      await expect(task.purgeInactiveUsers()).resolves.toBeUndefined();
    });
  });

  // ── vacuumDatabase ──────────────────────────────────────────────────────────

  describe('vacuumDatabase', () => {
    it('calls $executeRaw to run VACUUM ANALYZE', async () => {
      vi.mocked(prisma.db.$executeRaw).mockResolvedValue(0);

      await task.vacuumDatabase();

      expect(prisma.db.$executeRaw).toHaveBeenCalledOnce();
    });

    it('does not throw when $executeRaw succeeds', async () => {
      vi.mocked(prisma.db.$executeRaw).mockResolvedValue(0);

      await expect(task.vacuumDatabase()).resolves.toBeUndefined();
    });

    it('does not throw when $executeRaw fails (error is only logged)', async () => {
      vi.mocked(prisma.db.$executeRaw).mockRejectedValue(new Error('VACUUM failed'));

      await expect(task.vacuumDatabase()).resolves.toBeUndefined();
    });
  });
});
