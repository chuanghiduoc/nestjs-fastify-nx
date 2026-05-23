import { describe, it, expect } from 'vitest';
import { HealthCheckError } from '@nestjs/terminus';
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

describe('PrismaReplicationLagHealthIndicator', () => {
  it('returns healthy with replicaConfigured:false when hasReplica is false', async () => {
    const indicator = new PrismaReplicationLagHealthIndicator(makePrisma({ hasReplica: false }));

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('up');
    expect(result['replication_lag']).toMatchObject({ replicaConfigured: false });
  });

  it('returns healthy with lag when replica is in recovery and lag <= 30', async () => {
    const indicator = new PrismaReplicationLagHealthIndicator(
      makePrisma({ queryResult: [{ lag_seconds: 0.42, is_replica: true }] }),
    );

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('up');
    expect(result['replication_lag']).toMatchObject({ lag: 0.42 });
  });

  it('treats null lag_seconds as 0 when replica has no transactions replayed yet', async () => {
    const indicator = new PrismaReplicationLagHealthIndicator(
      makePrisma({ queryResult: [{ lag_seconds: null, is_replica: true }] }),
    );

    const result = await indicator.isHealthy('replication_lag');

    expect(result['replication_lag'].status).toBe('up');
    expect(result['replication_lag']).toMatchObject({ lag: 0 });
  });

  it('throws HealthCheckError when is_replica is false (promoted node)', async () => {
    const indicator = new PrismaReplicationLagHealthIndicator(
      makePrisma({ queryResult: [{ lag_seconds: 0, is_replica: false }] }),
    );

    await expect(indicator.isHealthy('replication_lag')).rejects.toThrow(HealthCheckError);
    await expect(indicator.isHealthy('replication_lag')).rejects.toMatchObject({
      message: expect.stringContaining('no longer in recovery'),
    });
  });

  it('throws HealthCheckError when lag exceeds 30 seconds', async () => {
    const indicator = new PrismaReplicationLagHealthIndicator(
      makePrisma({ queryResult: [{ lag_seconds: 45.1, is_replica: true }] }),
    );

    await expect(indicator.isHealthy('replication_lag')).rejects.toThrow(HealthCheckError);
    await expect(indicator.isHealthy('replication_lag')).rejects.toMatchObject({
      message: expect.stringContaining('lag too high'),
    });
  });

  it('throws HealthCheckError when replica query throws (unreachable)', async () => {
    const indicator = new PrismaReplicationLagHealthIndicator(
      makePrisma({ queryThrows: new Error('ECONNREFUSED') }),
    );

    await expect(indicator.isHealthy('replication_lag')).rejects.toThrow(HealthCheckError);
    await expect(indicator.isHealthy('replication_lag')).rejects.toMatchObject({
      message: expect.stringContaining('unreachable'),
    });
  });
});
