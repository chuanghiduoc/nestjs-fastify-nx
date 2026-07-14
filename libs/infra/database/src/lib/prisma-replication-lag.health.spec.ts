import { describe, it, expect } from 'vitest';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaReplicationLagHealthIndicator } from './prisma-replication-lag.health';
import type { PrismaService } from './prisma.service';

type LagRow = { lag_seconds: number | null; is_replica: boolean };

function makePrisma(overrides: {
  hasReplica?: boolean;
  queryResult?: LagRow[];
  queryThrows?: Error;
}): PrismaService {
  const { hasReplica = true, queryResult, queryThrows } = overrides;

  const dbRead = {
    $queryRawUnsafe: queryThrows
      ? () => Promise.reject(queryThrows)
      : () => Promise.resolve(queryResult ?? []),
  };

  return { hasReplica, dbRead } as unknown as PrismaService;
}

function makeIndicator(prisma: PrismaService): PrismaReplicationLagHealthIndicator {
  return new PrismaReplicationLagHealthIndicator(new HealthIndicatorService(), prisma);
}

describe('PrismaReplicationLagHealthIndicator', () => {
  it('returns healthy with replicaConfigured:false when hasReplica is false', async () => {
    const indicator = makeIndicator(makePrisma({ hasReplica: false }));

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('up');
    expect(result['replication_lag']).toMatchObject({ replicaConfigured: false });
  });

  it('returns healthy with lag when replica is in recovery and lag <= 30', async () => {
    const indicator = makeIndicator(
      makePrisma({ queryResult: [{ lag_seconds: 0.42, is_replica: true }] }),
    );

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('up');
    expect(result['replication_lag']).toMatchObject({ lag: 0.42 });
  });

  it('treats null lag_seconds as 0 when replica has no transactions replayed yet', async () => {
    const indicator = makeIndicator(
      makePrisma({ queryResult: [{ lag_seconds: null, is_replica: true }] }),
    );

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('up');
    expect(result['replication_lag']).toMatchObject({ lag: 0 });
  });

  it('reports down when is_replica is false (promoted node)', async () => {
    const indicator = makeIndicator(
      makePrisma({ queryResult: [{ lag_seconds: 0, is_replica: false }] }),
    );

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('down');
    expect(result['replication_lag']).toMatchObject({
      message: expect.stringContaining('no longer in recovery'),
    });
  });

  it('reports down when lag exceeds 30 seconds', async () => {
    const indicator = makeIndicator(
      makePrisma({ queryResult: [{ lag_seconds: 45.1, is_replica: true }] }),
    );

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('down');
    expect(result['replication_lag']).toMatchObject({
      message: expect.stringContaining('lag too high'),
    });
  });

  it('reports down when replica query throws (unreachable)', async () => {
    const indicator = makeIndicator(makePrisma({ queryThrows: new Error('ECONNREFUSED') }));

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('down');
    expect(result['replication_lag']).toMatchObject({
      message: expect.stringContaining('unreachable'),
    });
  });
});
