import { Injectable, Logger, Optional } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { Client, ClientConfig } from 'pg';

const PROBE_TIMEOUT_MS = 2_000;
// Public readiness payload must not echo driver internals (libpq messages
// often include host/user/database). Keep the operator-friendly detail in
// the server log and emit a stable, sanitized marker to the response.
const SANITIZED_ERROR = 'probe_failed';

// connect() returns Promise<Client> in pg@8 (not Promise<void>) — use unknown
// so this interface is structurally compatible with the concrete pg Client.
export interface PgClientLike {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export type PgClientFactory = (config: ClientConfig) => PgClientLike;

const defaultClientFactory: PgClientFactory = (config) => new Client(config);

// Uses a raw pg Client (not Prisma) so a saturated pool does not mask a healthy
// pgbouncer and a crashed pgbouncer does not block on pool acquisition before
// returning 503. No-ops when DATABASE_DIRECT_URL is unset — the boilerplate
// default where PrismaHealthIndicator already covers the database path.
@Injectable()
export class PgBouncerHealthIndicator extends HealthIndicator {
  private readonly clientFactory: PgClientFactory;
  private readonly logger = new Logger(PgBouncerHealthIndicator.name);

  // @Optional() lets the default factory apply when no DI provider supplies
  // a PgClientFactory token — otherwise Nest throws UnknownDependenciesException
  // because function types have no token to resolve.
  constructor(@Optional() clientFactory: PgClientFactory = defaultClientFactory) {
    super();
    this.clientFactory = clientFactory;
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const directUrl = process.env['DATABASE_DIRECT_URL'];
    if (!directUrl) {
      return this.getStatus(key, true, {
        skipped: true,
        message: 'no DATABASE_DIRECT_URL configured — pooler probe disabled',
      });
    }

    // 2s timeout: a slow pooler response is itself a signal worth surfacing.
    const client = this.clientFactory({
      connectionString: process.env['DATABASE_URL'],
      connectionTimeoutMillis: PROBE_TIMEOUT_MS,
      statement_timeout: PROBE_TIMEOUT_MS,
    });

    try {
      await client.connect();
      await client.query('SELECT 1');
      return this.getStatus(key, true);
    } catch (err) {
      this.logger.warn(`pgbouncer readiness probe failed: ${String(err)}`);
      throw new HealthCheckError(
        'PgBouncer unreachable',
        this.getStatus(key, false, { error: SANITIZED_ERROR }),
      );
    } finally {
      // Swallow disconnect errors so a failed connect() does not mask the
      // HealthCheckError thrown above with an unhandled rejection.
      await client.end().catch(() => undefined);
    }
  }
}
