import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { injectDatabasePassword, intEnv } from '@nestjs-fastify-nx/shared';

/**
 * Extract the transaction client type from the interactive-transaction overload
 * of $transaction.  This avoids importing from an unstable internal path
 * (`@prisma/client/runtime/library`) while remaining fully typed.
 *
 * The interactive-transaction overload is: $transaction<R>(fn: (client: TX) => Promise<R>)
 * where TX = Omit<PrismaClient, ITXClientDenyList>.
 */
type TransactionClient = Parameters<PrismaClient['$transaction']>[0] extends (
  client: infer TX,
) => Promise<unknown>
  ? TX
  : never;

function buildPgAdapter(
  connectionString: string,
  options: {
    poolMax: number;
    poolMin: number;
    applicationName: string;
  },
): PrismaPg {
  return new PrismaPg({
    connectionString,
    max: options.poolMax,
    min: options.poolMin,
    idleTimeoutMillis: intEnv('DATABASE_IDLE_TIMEOUT_MS', 10_000),
    connectionTimeoutMillis: intEnv('DATABASE_CONNECTION_TIMEOUT_MS', 5_000),
    statement_timeout: intEnv('DATABASE_STATEMENT_TIMEOUT_MS', 30_000),
    application_name: options.applicationName,
  });
}

/**
 * Maintains two PrismaClient instances:
 *   - `db`      → primary (write, Better Auth, outbox relay, command handlers)
 *   - `dbRead`  → replica when DATABASE_REPLICA_URL is set; aliases to `db` otherwise
 *
 * Keeping them separate (rather than wrapping via @prisma/extension-read-replicas)
 * is critical: Better Auth uses `db` via prismaAdapter() and reads the sessions
 * table on the same primary connection. Routing that read to a replica would
 * surface replication lag as a 401 immediately after sign-in.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly _writeClient: PrismaClient;
  private readonly _readClient: PrismaClient;
  private readonly _hasReplica: boolean;

  constructor() {
    // Docker-secrets / k8s deployments mount the DB password as a file and
    // publish DATABASE_URL without the password segment, so the secret is never
    // visible via `docker inspect` / `kubectl describe`. injectDatabasePassword
    // is a no-op when DB_PASSWORD_FILE is unset or the URL already has a
    // password, so dev / CI setups using inline credentials are unaffected.
    const passwordFile = process.env['DB_PASSWORD_FILE'];
    const writeUrl = injectDatabasePassword(process.env['DATABASE_URL'], passwordFile);
    if (!writeUrl) throw new Error('DATABASE_URL is required');

    const appName = process.env['DATABASE_APPLICATION_NAME'] ?? 'nestjs-fastify-api';

    this._writeClient = new PrismaClient({
      adapter: buildPgAdapter(writeUrl, {
        poolMax: intEnv('DATABASE_POOL_MAX', 20),
        poolMin: intEnv('DATABASE_POOL_MIN', 0),
        applicationName: `${appName}-write`,
      }),
    });

    const replicaUrl = injectDatabasePassword(
      process.env['DATABASE_REPLICA_URL']?.trim(),
      passwordFile,
    );
    this._hasReplica = !!replicaUrl;

    if (this._hasReplica) {
      this._readClient = new PrismaClient({
        adapter: buildPgAdapter(replicaUrl as string, {
          poolMax: intEnv('DATABASE_REPLICA_POOL_MAX', 10),
          poolMin: 0,
          applicationName: `${appName}-read`,
        }),
      });
      this.logger.log('Read replica enabled via DATABASE_REPLICA_URL');
    } else {
      // No replica configured — dbRead aliases to write client. Zero behaviour change.
      this._readClient = this._writeClient;
    }
  }

  /** Primary (write) client — Better Auth, outbox relay, command handlers. */
  get db(): PrismaClient {
    return this._writeClient;
  }

  /**
   * Read client — repository list/find queries that tolerate replication lag.
   * Aliases to `db` when DATABASE_REPLICA_URL is unset (single-node default).
   */
  get dbRead(): PrismaClient {
    return this._readClient;
  }

  get hasReplica(): boolean {
    return this._hasReplica;
  }

  /**
   * Interactive transaction always runs on the write client. Replica connections
   * are stateless reads; they must not participate in coordinated transactions.
   */
  async transaction<R>(
    fn: (client: TransactionClient) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R> {
    return this._writeClient.$transaction(fn, options);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this._writeClient.$connect();
      if (this._hasReplica) await this._readClient.$connect();
      this.logger.log('Database connection established');
    } catch (err) {
      // Re-throw so NestJS lifecycle manager surfaces the error and aborts
      // startup rather than silently running with a dead DB connection.
      throw new Error(`DatabaseModule: failed to connect — ${String(err)}`, {
        cause: err,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this._writeClient.$disconnect();
      if (this._hasReplica) await this._readClient.$disconnect();
      this.logger.log('Database connection closed');
    } catch (err) {
      // Log but don't re-throw; we are already shutting down.
      this.logger.error('DatabaseModule: error during disconnect', String(err));
    }
  }
}
