import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { BatchedPurgeRunner } from './batched-purge.runner';
import { NotificationCleanupTask } from './notification-cleanup.task';

function makePrismaMock() {
  return {
    db: {
      $executeRawUnsafe: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('NotificationCleanupTask', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let runner: BatchedPurgeRunner;

  beforeEach(() => {
    prisma = makePrismaMock();
    runner = new BatchedPurgeRunner(prisma);
  });

  it('purges read notifications past the retention window', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);
    const task = new NotificationCleanupTask({ isLeader: () => true } as never, runner);

    await task.purgeReadNotifications();

    const [sql, cutoff] = vi.mocked(prisma.db.$executeRawUnsafe).mock.calls[0] as [string, string];
    expect(sql).toMatch(/DELETE FROM "notifications"/);
    expect(sql).toMatch(/"createdAt" < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
    expect(sql).toMatch(/"readAt" IS NOT NULL/);
    expect(Number(cutoff)).toBe(90);
  });

  it('never touches the database as a follower', async () => {
    const task = new NotificationCleanupTask({ isLeader: () => false } as never, runner);

    await task.purgeReadNotifications();

    expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
