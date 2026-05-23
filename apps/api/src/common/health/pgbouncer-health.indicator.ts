import { Injectable, Logger, Optional } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { Client, ClientConfig } from 'pg';
import { injectDatabasePassword } from '@nestjs-fastify-nx/shared';

const PROBE_TIMEOUT_MS = 2_000;
// Sanitized marker — libpq internals (host/user/db) must not leak into readiness responses.
const SANITIZED_ERROR = 'probe_failed';

// pg@8 connect() returns Promise<Client> not Promise<void> — unknown keeps structural compat.
export interface PgClientLike {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export type PgClientFactory = (config: ClientConfig) => PgClientLike;

const defaultClientFactory: PgClientFactory = (config) => new Client(config);

// Raw pg Client bypasses Prisma pool — a saturated pool cannot mask a crashed pgbouncer.
@Injectable()
export class PgBouncerHealthIndicator extends HealthIndicator {
  private readonly clientFactory: PgClientFactory;
  private readonly logger = new Logger(PgBouncerHealthIndicator.name);

  // @Optional() avoids UnknownDependenciesException; function types have no DI token.
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

    // Docker-secrets / k8s deployments publish DATABASE_URL without the password
    // and mount it at DB_PASSWORD_FILE. Mirror PrismaService so the probe doesn't
    // silently 503 the pod under the documented prod overlay.
    const connectionString = injectDatabasePassword(
      process.env['DATABASE_URL'],
      process.env['DB_PASSWORD_FILE'],
    );

    const client = this.clientFactory({
      connectionString,
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
      await client.end().catch(() => undefined);
    }
  }
}
