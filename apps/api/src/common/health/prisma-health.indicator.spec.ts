/// <reference types="vitest/globals" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PrismaHealthIndicator } from './prisma-health.indicator';

function buildPrisma(queryRaw: ReturnType<typeof vi.fn>): PrismaService {
  return { db: { $queryRaw: queryRaw } } as unknown as PrismaService;
}

describe('PrismaHealthIndicator', () => {
  let queryRaw: ReturnType<typeof vi.fn>;
  let indicator: PrismaHealthIndicator;

  beforeEach(() => {
    queryRaw = vi.fn();
    indicator = new PrismaHealthIndicator(new HealthIndicatorService(), buildPrisma(queryRaw));
  });

  it('reports up when SELECT 1 succeeds', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const result = await indicator.isHealthy('database');

    expect(result['database'].status).toBe('up');
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('reports down and sanitizes the error when the query rejects', async () => {
    queryRaw.mockRejectedValueOnce(new Error('password authentication failed for user "app"'));

    const result = await indicator.isHealthy('database');

    expect(result['database']).toMatchObject({ status: 'down', error: 'probe_failed' });
  });

  it('reports down when the query hangs past the probe timeout', async () => {
    vi.useFakeTimers();
    try {
      queryRaw.mockImplementationOnce(() => new Promise(() => undefined));

      const resultPromise = indicator.isHealthy('database');
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await resultPromise;

      expect(result['database']).toMatchObject({ status: 'down', error: 'probe_failed' });
    } finally {
      vi.useRealTimers();
    }
  });
});
