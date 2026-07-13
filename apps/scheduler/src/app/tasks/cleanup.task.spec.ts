import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CleanupTask } from './cleanup.task';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

/** Minimal PrismaService mock that covers the methods used by CleanupTask. */
function makePrismaMock() {
  return {
    db: {
      user: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      $executeRaw: vi.fn(),
      $executeRawUnsafe: vi.fn(),
      $queryRaw: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('CleanupTask', () => {
  let task: CleanupTask;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    task = new CleanupTask(prisma, { isLeader: () => true } as never);
  });

  // ── purgeInactiveUsers ──────────────────────────────────────────────────────

  describe('purgeInactiveUsers', () => {
    it('queries candidates with status INACTIVE and updatedAt less than the 90-day cutoff', async () => {
      vi.mocked(prisma.db.user.findMany).mockResolvedValue([]);

      const before = new Date();
      await task.purgeInactiveUsers();
      const after = new Date();

      expect(prisma.db.user.findMany).toHaveBeenCalledOnce();
      expect(prisma.db.user.deleteMany).not.toHaveBeenCalled();

      const [callArgs] = vi.mocked(prisma.db.user.findMany).mock.calls;
      const { where } = callArgs[0] as {
        where: { status: string; updatedAt: { lt: Date } };
      };

      expect(where.status).toBe('INACTIVE');
      expect(where.updatedAt.lt).toBeInstanceOf(Date);

      // Cutoff must be ~90 days before now (allow ±1 second for test timing)
      const expectedMin = new Date(before.getTime() - 90 * 24 * 60 * 60 * 1_000 - 1_000);
      const expectedMax = new Date(after.getTime() - 90 * 24 * 60 * 60 * 1_000 + 1_000);
      expect(where.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(where.updatedAt.lt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });

    it('deletes candidates by id and stops when fewer than batch size are returned', async () => {
      vi.mocked(prisma.db.user.findMany).mockResolvedValueOnce([
        { id: 'u1' },
        { id: 'u2' },
      ] as never);
      vi.mocked(prisma.db.user.deleteMany).mockResolvedValue({ count: 2 });

      await task.purgeInactiveUsers();

      expect(prisma.db.user.findMany).toHaveBeenCalledOnce();
      expect(prisma.db.user.deleteMany).toHaveBeenCalledOnce();
      expect(prisma.db.user.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['u1', 'u2'] },
          status: 'INACTIVE',
          updatedAt: { lt: expect.any(Date) },
        },
      });
    });

    it('loops until findMany returns fewer rows than the batch size', async () => {
      const fullBatch = Array.from({ length: 500 }, (_, i) => ({ id: `u${i}` }));
      vi.mocked(prisma.db.user.findMany)
        .mockResolvedValueOnce(fullBatch as never)
        .mockResolvedValueOnce([{ id: 'last' }] as never);
      vi.mocked(prisma.db.user.deleteMany).mockResolvedValue({ count: 500 });

      await task.purgeInactiveUsers();

      expect(prisma.db.user.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.db.user.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('does not throw when findMany succeeds with no candidates', async () => {
      vi.mocked(prisma.db.user.findMany).mockResolvedValue([]);

      await expect(task.purgeInactiveUsers()).resolves.toBeUndefined();
    });

    it('does not throw when findMany fails (error is only logged)', async () => {
      vi.mocked(prisma.db.user.findMany).mockRejectedValue(new Error('DB connection lost'));

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

  // ── ensureAuditLogPartitions ────────────────────────────────────────────────

  describe('ensureAuditLogPartitions', () => {
    it('invokes ensure_audit_log_partition for current and next two months', async () => {
      vi.mocked(prisma.db.$queryRaw).mockResolvedValue([]);

      await task.ensureAuditLogPartitions();

      expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it('does not throw when $queryRaw fails (error is only logged)', async () => {
      vi.mocked(prisma.db.$queryRaw).mockRejectedValue(new Error('partition create failed'));

      await expect(task.ensureAuditLogPartitions()).resolves.toBeUndefined();
    });
  });

  // ── purgeAuditLogPartitions ─────────────────────────────────────────────────

  describe('purgeAuditLogPartitions', () => {
    function fmtPartition(year: number, month: number): string {
      return `audit_logs_${year}_${String(month).padStart(2, '0')}`;
    }

    it('drops only partitions older than the retention cutoff', async () => {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;

      // Default retention = 12 months including current. Cutoff = current month - 11. Names
      // older than the cutoff month are dropped; names equal to or newer
      // than cutoff are kept.
      const cutoff = new Date(Date.UTC(currentYear, currentMonth - 1 - 11, 1));
      const oldName = fmtPartition(cutoff.getUTCFullYear(), cutoff.getUTCMonth()); // strictly older
      const cutoffName = fmtPartition(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1); // == cutoff, keep
      const recentName = fmtPartition(currentYear, currentMonth);

      vi.mocked(prisma.db.$queryRaw).mockResolvedValue([
        { table_name: oldName },
        { table_name: cutoffName },
        { table_name: recentName },
        { table_name: 'audit_logs_default' }, // ignored — name doesn't match regex
      ] as never);
      vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);

      await task.purgeAuditLogPartitions();

      expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledWith(`DROP TABLE IF EXISTS "${oldName}"`);
    });

    it('skips DROP entirely when there are no partitions older than the cutoff', async () => {
      const now = new Date();
      vi.mocked(prisma.db.$queryRaw).mockResolvedValue([
        { table_name: fmtPartition(now.getUTCFullYear(), now.getUTCMonth() + 1) },
      ] as never);

      await task.purgeAuditLogPartitions();

      expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('ignores child tables whose names do not match the YYYY_MM convention', async () => {
      vi.mocked(prisma.db.$queryRaw).mockResolvedValue([
        { table_name: 'audit_logs_archive' },
        { table_name: 'audit_logs_2010_99' }, // bogus month
      ] as never);

      await task.purgeAuditLogPartitions();

      // `audit_logs_2010_99` matches the regex but the test mainly verifies
      // we don't crash on weird names and don't drop the archive table.
      expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalledWith(
        expect.stringContaining('audit_logs_archive'),
      );
      expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalledWith(
        expect.stringContaining('audit_logs_2010_99'),
      );
    });

    it('does not throw when $queryRaw fails (error is only logged)', async () => {
      vi.mocked(prisma.db.$queryRaw).mockRejectedValue(new Error('catalog read failed'));

      await expect(task.purgeAuditLogPartitions()).resolves.toBeUndefined();
    });
  });
});
