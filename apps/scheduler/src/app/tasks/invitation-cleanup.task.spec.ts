import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { BatchedPurgeRunner } from './batched-purge.runner';
import { InvitationCleanupTask } from './invitation-cleanup.task';

function makePrismaMock() {
  return {
    db: {
      $executeRawUnsafe: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('InvitationCleanupTask', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let runner: BatchedPurgeRunner;

  beforeEach(() => {
    prisma = makePrismaMock();
    runner = new BatchedPurgeRunner(prisma);
  });

  it('purges invitations long past their expiry', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);
    const task = new InvitationCleanupTask({ isLeader: () => true } as never, runner);

    await task.purgeExpiredInvitations();

    const [sql, cutoff] = vi.mocked(prisma.db.$executeRawUnsafe).mock.calls[0] as [string, string];
    expect(sql).toMatch(/DELETE FROM "invitations"/);
    expect(sql).toMatch(/"expiresAt" < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
    expect(Number(cutoff)).toBe(30);
  });

  it('never touches the database as a follower', async () => {
    const task = new InvitationCleanupTask({ isLeader: () => false } as never, runner);

    await task.purgeExpiredInvitations();

    expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
