import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboxLagCollector } from './outbox-lag.collector';
import type { MetricsService } from './metrics.service';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

function makeMockPrisma(lagSeconds: number | null): PrismaService {
  return {
    db: {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ lag_seconds: lagSeconds }]),
    },
  } as unknown as PrismaService;
}

function makeMockMetrics(): MetricsService {
  return {
    outboxLagSeconds: { set: vi.fn() },
  } as unknown as MetricsService;
}

describe('OutboxLagCollector', () => {
  let prisma: PrismaService;
  let metrics: MetricsService;
  let collector: OutboxLagCollector;

  beforeEach(() => {
    prisma = makeMockPrisma(42.5);
    metrics = makeMockMetrics();
    collector = new OutboxLagCollector(prisma, metrics);
  });

  it('sets the gauge to the lag_seconds returned by the query', async () => {
    await collector.collect();

    expect(metrics.outboxLagSeconds.set).toHaveBeenCalledWith(42.5);
  });

  it('sets the gauge to 0 when lag_seconds is null (no unprocessed events)', async () => {
    prisma = makeMockPrisma(null);
    collector = new OutboxLagCollector(prisma, metrics);

    await collector.collect();

    expect(metrics.outboxLagSeconds.set).toHaveBeenCalledWith(0);
  });

  it('does not throw when the query rejects — error is non-fatal', async () => {
    vi.mocked(prisma.db.$queryRawUnsafe).mockRejectedValueOnce(new Error('DB connection lost'));

    // `collect()` returns Promise<void> and catches internally; assert it
    // resolved successfully. `.resolves.not.toThrow()` is not a valid Vitest
    // matcher — `.toThrow` is a function-call matcher and is not chainable
    // through `.resolves`. Earlier this silently passed regardless of outcome.
    await expect(collector.collect()).resolves.toBeUndefined();
  });

  it('does not update the gauge when the query rejects — gauge stays stale', async () => {
    vi.mocked(prisma.db.$queryRawUnsafe).mockRejectedValueOnce(new Error('timeout'));

    await collector.collect();

    expect(metrics.outboxLagSeconds.set).not.toHaveBeenCalled();
  });

  it('issues the correct SQL targeting unprocessed outbox rows', async () => {
    await collector.collect();

    const [sql] = vi.mocked(prisma.db.$queryRawUnsafe).mock.calls[0] as [string];
    expect(sql).toContain('"outbox_events"');
    expect(sql).toContain('"processedAt" IS NULL');
    expect(sql).toContain('MIN("createdAt")');
  });
});
