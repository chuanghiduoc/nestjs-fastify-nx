import { Injectable, Logger } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from './prisma.service';

type LagRow = { lag_seconds: number | null; is_replica: boolean };

// Readiness payload is publicly callable; raw Prisma/libpq errors leak
// connection string segments and replica topology. Emit a stable marker
// in the response and log the real cause for operators.
const SANITIZED_ERROR = 'probe_failed';

/**
 * Terminus health indicator that queries pg_last_xact_replay_timestamp() on
 * the read replica. Reports lag_seconds as metadata and fails when:
 *   - the "replica" URL resolves to a primary (pg_is_in_recovery() = false), or
 *   - lag exceeds 30 seconds, or
 *   - the replica is unreachable.
 *
 * When DATABASE_REPLICA_URL is unset the indicator is a no-op (returns healthy
 * with replicaConfigured: false) so it never flips /health/ready to 503 on
 * single-node deployments.
 */
@Injectable()
export class PrismaReplicationLagHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(PrismaReplicationLagHealthIndicator.name);

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

    // pg_is_in_recovery() = false after failover promotion — the node accepted
    // writes and pg_last_xact_replay_timestamp() returns NULL, producing lag = 0.
    // Surfacing this prevents silently routing reads to an ex-replica primary.
    if (!rows[0]?.is_replica) {
      throw new HealthCheckError(
        'DATABASE_REPLICA_URL points at a node that is no longer in recovery (promoted?)',
        this.getStatus(key, false, { is_replica: false }),
      );
    }

    const lag = rows[0]?.lag_seconds ?? 0;

    if (lag > 30) {
      throw new HealthCheckError('Replication lag too high', this.getStatus(key, false, { lag }));
    }

    return this.getStatus(key, true, { lag });
  }
}
