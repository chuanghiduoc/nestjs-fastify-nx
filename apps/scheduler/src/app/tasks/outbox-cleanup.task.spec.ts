import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutboxCleanupTask } from './outbox-cleanup.task';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

function makePrismaMock() {
  return {
    db: {
      $executeRawUnsafe: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('OutboxCleanupTask', () => {
  let task: OutboxCleanupTask;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    task = new OutboxCleanupTask(prisma, { isLeader: () => true } as never);
  });

  describe('purgeOldOutboxEvents', () => {
    it('issues DELETE with processedAt IS NOT NULL and createdAt age filter', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);

      await task.purgeOldOutboxEvents();

      expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledOnce();

      const [sql] = vi.mocked(prisma.db.$executeRawUnsafe).mock.calls[0] as [string, ...unknown[]];
      expect(sql).toMatch(/"processedAt" IS NOT NULL/);
      expect(sql).toMatch(/"createdAt" < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
      expect(sql).toMatch(/LIMIT \$2/);
    });

    it('passes retentionDays as the first parameter and BATCH_SIZE as the second', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);

      await task.purgeOldOutboxEvents();

      const [, retentionParam, batchParam] = vi.mocked(prisma.db.$executeRawUnsafe).mock
        .calls[0] as [string, string, number];

      // retentionDays must be a string (parameterised via $1 string concat)
      expect(typeof retentionParam).toBe('string');
      expect(Number(retentionParam)).toBeGreaterThan(0);

      // batchParam must be a positive number (LIMIT $2)
      expect(typeof batchParam).toBe('number');
      expect(batchParam).toBeGreaterThan(0);
    });

    it('stops looping when $executeRawUnsafe returns 0 rows', async () => {
      // Returns 5 on first call, 0 on second — loop should break after 2 iterations
      vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValueOnce(5).mockResolvedValueOnce(0);

      await task.purgeOldOutboxEvents();

      expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('accumulates totalPurged across multiple batches', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe)
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(0);

      const logSpy = vi.spyOn(task['logger'], 'log');

      await task.purgeOldOutboxEvents();

      const completeLog = logSpy.mock.calls.find((c) => String(c[0]).includes('complete'));
      expect(completeLog).toBeDefined();
      if (completeLog) {
        expect(String(completeLog[0])).toContain('2000');
      }
    });

    it('does not throw when $executeRawUnsafe returns 0 immediately (nothing to purge)', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);

      await expect(task.purgeOldOutboxEvents()).resolves.toBeUndefined();
    });

    it('logs partial progress and does not throw when an error occurs mid-loop', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe)
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(500)
        .mockRejectedValueOnce(new Error('DB connection lost'));

      const errorSpy = vi.spyOn(task['logger'], 'error');

      await expect(task.purgeOldOutboxEvents()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]).toEqual([
        { err: expect.any(Error), totalPurged: 1500 },
        'Outbox purge failed',
      ]);
    });

    it('does not throw when $executeRawUnsafe fails on the very first batch', async () => {
      vi.mocked(prisma.db.$executeRawUnsafe).mockRejectedValue(new Error('fatal'));

      await expect(task.purgeOldOutboxEvents()).resolves.toBeUndefined();
    });
  });

  describe('purgeParkedOutboxEvents', () => {
    it('deletes only rows with exhausted attempts, NULL processedAt, past the parked cutoff', async () => {
      const db = prisma.db as unknown as { $queryRawUnsafe: ReturnType<typeof vi.fn> };
      db.$queryRawUnsafe = vi.fn().mockResolvedValue([]);

      await task.purgeParkedOutboxEvents();

      const [sql, maxAttempts, cutoffDays] = db.$queryRawUnsafe.mock.calls[0] as unknown as [
        string,
        number,
        string,
      ];
      expect(sql).toMatch(/"processedAt" IS NULL/);
      expect(sql).toMatch(/attempts >= \$1/);
      expect(maxAttempts).toBe(10);
      expect(Number(cutoffDays)).toBe(30);
      expect(db.$queryRawUnsafe).toHaveBeenCalledOnce();
    });

    it('stops looping when RETURNING yields no rows', async () => {
      const db = prisma.db as unknown as { $queryRawUnsafe: ReturnType<typeof vi.fn> };
      db.$queryRawUnsafe = vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'r1', eventType: 'users.registered', attempts: 10, lastError: 'x' },
        ])
        .mockResolvedValueOnce([]);

      await task.purgeParkedOutboxEvents();

      expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('logs each dropped row with its identity before returning', async () => {
      const db = prisma.db as unknown as { $queryRawUnsafe: ReturnType<typeof vi.fn> };
      db.$queryRawUnsafe = vi.fn().mockResolvedValue([
        { id: 'row-1', eventType: 'users.registered', attempts: 10, lastError: 'schema drift' },
        { id: 'row-2', eventType: 'organizations.created', attempts: 12, lastError: null },
      ]);
      const logSpy = vi.spyOn(task['logger'], 'warn');

      await task.purgeParkedOutboxEvents();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          outboxId: 'row-1',
          eventType: 'users.registered',
          lastError: 'schema drift',
        }),
        'Dropping permanently-parked outbox row past its retention window',
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ outboxId: 'row-2' }),
        'Dropping permanently-parked outbox row past its retention window',
      );
    });

    it('does not throw when $queryRawUnsafe fails mid-run', async () => {
      const db = prisma.db as unknown as { $queryRawUnsafe: ReturnType<typeof vi.fn> };
      db.$queryRawUnsafe = vi.fn().mockRejectedValue(new Error('DB connection lost'));
      const errorSpy = vi.spyOn(task['logger'], 'error');

      await expect(task.purgeParkedOutboxEvents()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });
});
