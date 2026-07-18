import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionCleanupTask } from './session-cleanup.task';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

function makePrismaMock() {
  return {
    db: {
      $executeRawUnsafe: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('SessionCleanupTask', () => {
  let task: SessionCleanupTask;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    task = new SessionCleanupTask(prisma, { isLeader: () => true } as never);
  });

  describe('purgeExpiredSessions', () => {
    it('issues DELETE filtered on expiresAt past the grace window', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);

      await task.purgeExpiredSessions();

      const [sql] = vi.mocked(prisma.db.$executeRawUnsafe).mock.calls[0] as [string, ...unknown[]];
      expect(sql).toMatch(/DELETE FROM "sessions"/);
      expect(sql).toMatch(/"expiresAt" < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
      expect(sql).toMatch(/LIMIT \$2/);
    });

    it('passes graceDays as a string parameter and batch size as a positive number', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);

      await task.purgeExpiredSessions();

      const [, graceParam, batchParam] = vi.mocked(prisma.db.$executeRawUnsafe).mock.calls[0] as [
        string,
        string,
        number,
      ];

      expect(typeof graceParam).toBe('string');
      expect(Number(graceParam)).toBeGreaterThan(0);
      expect(typeof batchParam).toBe('number');
      expect(batchParam).toBeGreaterThan(0);
    });

    it('skips entirely when this replica is not the scheduler leader', async () => {
      const follower = new SessionCleanupTask(prisma, { isLeader: () => false } as never);

      await follower.purgeExpiredSessions();

      expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('stops looping when a batch deletes 0 rows', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValueOnce(5).mockResolvedValueOnce(0);

      await task.purgeExpiredSessions();

      expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('accumulates totalPurged across batches', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe)
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(0);

      const logSpy = vi.spyOn(task['logger'], 'log');

      await task.purgeExpiredSessions();

      const completeLog = logSpy.mock.calls.find((c) => String(c[0]).includes('complete'));
      expect(completeLog).toBeDefined();
      expect(String(completeLog?.[0])).toContain('2000');
    });

    it('logs partial progress and does not throw when a batch fails mid-loop', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe)
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(500)
        .mockRejectedValueOnce(new Error('DB connection lost'));

      const errorSpy = vi.spyOn(task['logger'], 'error');

      await expect(task.purgeExpiredSessions()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledOnce();
      const [msg] = errorSpy.mock.calls[0] as [string];
      expect(msg).toContain('1500');
      expect(msg).toMatch(/DB connection lost/);
    });

    it('does not throw when the very first batch fails', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe).mockRejectedValue(new Error('fatal'));

      await expect(task.purgeExpiredSessions()).resolves.toBeUndefined();
    });
  });
});
