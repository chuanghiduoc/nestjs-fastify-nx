import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchedPurgeRunner, type BatchedPurgeConfig } from './batched-purge.runner';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

const CONFIG: BatchedPurgeConfig = {
  table: 'sessions',
  column: 'expiresAt',
  envPrefix: 'SESSION',
  defaultBatchSize: 500,
  defaultMaxBatches: 3,
  label: 'Test purge',
};

function makePrismaMock() {
  return {
    db: {
      $executeRawUnsafe: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('BatchedPurgeRunner', () => {
  let runner: BatchedPurgeRunner;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    vi.unstubAllEnvs();
    runner = new BatchedPurgeRunner(prisma);
  });

  it('issues a batched DELETE against the configured table/column', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);

    await runner.purgeIfLeader('k', true, CONFIG, 7);

    const [sql, cutoff, batch] = vi.mocked(prisma.db.$executeRawUnsafe).mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(sql).toMatch(/DELETE FROM "sessions"/);
    expect(sql).toMatch(/"expiresAt" < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
    expect(sql).toMatch(/LIMIT \$2/);
    expect(cutoff).toBe('7');
    expect(batch).toBe(500);
  });

  it('skips entirely when not leader', async () => {
    await runner.purgeIfLeader('k', false, CONFIG, 7);

    expect(prisma.db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('stops looping when a batch deletes 0 rows', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValueOnce(5).mockResolvedValueOnce(0);

    await runner.purgeIfLeader('k', true, CONFIG, 7);

    expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('does not re-enter while a previous run with the same key is still going', async () => {
    let release!: () => void;
    const gate = new Promise<number>((resolve) => {
      release = () => resolve(1);
    });
    vi.mocked(prisma.db.$executeRawUnsafe)
      .mockImplementationOnce(() => gate as never)
      .mockResolvedValue(0);

    const first = runner.purgeIfLeader('k', true, CONFIG, 7);
    await Promise.resolve();
    const second = runner.purgeIfLeader('k', true, CONFIG, 7);
    await second;

    expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('allows concurrent purges under different keys', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe).mockResolvedValue(0);

    await Promise.all([
      runner.purgeIfLeader('a', true, CONFIG, 7),
      runner.purgeIfLeader('b', true, { ...CONFIG, table: 'verifications', label: 'Other' }, 7),
    ]);

    expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('logs partial progress and swallows a mid-loop failure', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe)
      .mockResolvedValueOnce(1000)
      .mockRejectedValue(new Error('DB connection lost'));
    const errorSpy = vi.spyOn(runner['logger'], 'error');

    await expect(runner.purgeIfLeader('k', true, CONFIG, 7)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.any(Error), totalPurged: 1000 },
      'Test purge failed',
    );
  });

  it('clears the overlap slot after a failure so the next cron run can proceed', async () => {
    vi.mocked(prisma.db.$executeRawUnsafe)
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);

    await runner.purgeIfLeader('k', true, CONFIG, 7);
    await runner.purgeIfLeader('k', true, CONFIG, 7);

    expect(prisma.db.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });
});
