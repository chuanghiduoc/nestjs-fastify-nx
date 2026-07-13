import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HeartbeatTask } from './heartbeat.task';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

/** Minimal PrismaService mock that covers the methods used by HeartbeatTask. */
function makePrismaMock() {
  return {
    db: {
      $queryRaw: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('HeartbeatTask', () => {
  let task: HeartbeatTask;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    task = new HeartbeatTask(prisma, { isLeader: () => true } as never);
  });

  it('calls $queryRaw to ping the database', async () => {
    vi.mocked(prisma.db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);

    await task.ping();

    expect(prisma.db.$queryRaw).toHaveBeenCalledOnce();
  });

  it('does not throw when $queryRaw succeeds', async () => {
    vi.mocked(prisma.db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);

    await expect(task.ping()).resolves.toBeUndefined();
  });

  it('does not throw when $queryRaw fails (error is only logged)', async () => {
    vi.mocked(prisma.db.$queryRaw).mockRejectedValue(new Error('Connection refused'));

    await expect(task.ping()).resolves.toBeUndefined();
  });
});
