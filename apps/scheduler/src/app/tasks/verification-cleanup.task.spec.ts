import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchedPurgeRunner } from './batched-purge.runner';
import { VerificationCleanupTask } from './verification-cleanup.task';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

function makePrismaMock() {
  return {
    db: {
      $executeRawUnsafe: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('VerificationCleanupTask', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let runner: BatchedPurgeRunner;

  beforeEach(() => {
    prisma = makePrismaMock();
    runner = new BatchedPurgeRunner(prisma);
  });

  it('purges the verifications table on expiresAt past the grace window', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);
    const task = new VerificationCleanupTask({ isLeader: () => true } as never, runner);

    await task.purgeExpiredVerifications();

    const [sql, cutoff] = vi.mocked(prisma.db.$executeRawUnsafe).mock.calls[0] as [string, string];
    expect(sql).toMatch(/DELETE FROM "verifications"/);
    expect(sql).toMatch(/"expiresAt" < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
    expect(Number(cutoff)).toBeGreaterThan(0);
  });

  it('never touches the database as a follower', async () => {
    const task = new VerificationCleanupTask({ isLeader: () => false } as never, runner);

    await task.purgeExpiredVerifications();

    expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
