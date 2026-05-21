import { Injectable, Logger } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { PrismaService } from './prisma.service';

type LagRow = { lag_seconds: number | null; is_replica: boolean };

// Sanitized marker — raw libpq errors leak connection string segments and topology.
const SANITIZED_ERROR = 'probe_failed';

@Injectable()
export class PrismaReplicationLagHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(PrismaReplicationLagHealthIndicator.name);
  private readonly lagThresholdSeconds =
    positiveIntEnv('DB_REPLICATION_LAG_THRESHOLD_MS', 30_000) / 1_000;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!this.prisma.hasReplica) {
      return this.getStatus(key, true, { replicaConfigured: false });
    }

    let rows: LagRow[];
    try {
      rows = await this.prisma.dbRead.$queryRawUnsafe<LagRow[]>(
        `SELECT
           EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp()))::float AS lag_seconds,
           pg_is_in_recovery() AS is_replica`,
      );
    } catch (err) {
      this.logger.warn(`replica readiness probe failed: ${String(err)}`);
      throw new HealthCheckError(
        'Replica unreachable',
        this.getStatus(key, false, { error: SANITIZED_ERROR }),
      );
    }

    // pg_is_in_recovery() = false after failover promotion: node accepted writes, lag appears 0.
    // Fail loudly to prevent silently routing reads to an ex-replica primary.
    if (!rows[0]?.is_replica) {
      throw new HealthCheckError(
        'DATABASE_REPLICA_URL points at a node that is no longer in recovery (promoted?)',
        this.getStatus(key, false, { is_replica: false }),
      );
    }

    const lag = rows[0]?.lag_seconds ?? 0;

    if (lag > this.lagThresholdSeconds) {
      throw new HealthCheckError(
        'Replication lag too high',
        this.getStatus(key, false, { lag, threshold: this.lagThresholdSeconds }),
      );
    }

    return this.getStatus(key, true, { lag, threshold: this.lagThresholdSeconds });
  }
}
