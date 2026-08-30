import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchedPurgeRunner } from './batched-purge.runner';
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
  let prisma: ReturnType<typeof makePrismaMock>;
  let runner: BatchedPurgeRunner;

  beforeEach(() => {
    prisma = makePrismaMock();
    runner = new BatchedPurgeRunner(prisma);
  });

  it('purges the sessions table on expiresAt past the grace window', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);
    const task = new SessionCleanupTask({ isLeader: () => true } as never, runner);

    await task.purgeExpiredSessions();

    const [sql, cutoff] = vi.mocked(prisma.db.$executeRawUnsafe).mock.calls[0] as [string, string];
    expect(sql).toMatch(/DELETE FROM "sessions"/);
    expect(sql).toMatch(/"expiresAt" < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
    expect(Number(cutoff)).toBeGreaterThan(0);
  });

  it('never touches the database as a follower', async () => {
    const task = new SessionCleanupTask({ isLeader: () => false } as never, runner);

    await task.purgeExpiredSessions();

    expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
