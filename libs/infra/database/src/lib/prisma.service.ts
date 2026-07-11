import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { injectDatabasePassword, intEnv } from '@nestjs-fastify-nx/shared';

// Derived from the $transaction overload to avoid importing @prisma/client/runtime internals.
type TransactionClient = Parameters<PrismaClient['$transaction']>[0] extends (
  client: infer TX,
) => Promise<unknown>
  ? TX
  : never;

// Prisma's `$on('query', ...)` overload only narrows its callback to Prisma.QueryEvent when
// TypeScript can see the literal `log: [{ emit: 'event', level: 'query' }]` at the exact
// `new PrismaClient(...)` call site — a readonly field typed as the bare `PrismaClient` (this
// service constructs two, write + optional replica) loses that inference. This narrow
// structural cast is more reliable than fighting the generic across both instantiations.
interface PrismaQueryEventEmitter {
  $on(event: 'query', callback: (event: Prisma.QueryEvent) => void): void;
}

// Exported so the threshold decision is unit-testable without wiring a real Prisma event.
export function isSlowQuery(durationMs: number, thresholdMs: number): boolean {
  return durationMs > thresholdMs;
}

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

// Better Auth and outbox relay must use `db` (primary) — replica lag surfaces as 401 immediately after sign-in.
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly _writeClient: PrismaClient;
  private readonly _readClient: PrismaClient;
  private readonly _hasReplica: boolean;

  constructor() {
    const passwordFile = process.env['DB_PASSWORD_FILE'];
    const writeUrl = injectDatabasePassword(process.env['DATABASE_URL'], passwordFile);
    if (!writeUrl) throw new Error('DATABASE_URL is required');

    const appName = process.env['DATABASE_APPLICATION_NAME'] ?? 'nestjs-fastify-api';
    const slowQueryThresholdMs = intEnv('DATABASE_SLOW_QUERY_MS', 200);

    this._writeClient = new PrismaClient({
      adapter: buildPgAdapter(writeUrl, {
        poolMax: intEnv('DATABASE_POOL_MAX', 20),
        poolMin: intEnv('DATABASE_POOL_MIN', 0),
        applicationName: `${appName}-write`,
      }),
      log: [{ emit: 'event', level: 'query' }],
    });
    this.registerSlowQueryLogger(this._writeClient, slowQueryThresholdMs);

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
        log: [{ emit: 'event', level: 'query' }],
      });
      this.registerSlowQueryLogger(this._readClient, slowQueryThresholdMs);
      this.logger.log('Read replica enabled via DATABASE_REPLICA_URL');
    } else {
      this._readClient = this._writeClient;
    }
  }

  // Only `query` (the parameterized SQL template) and `duration` are logged — `params` is
  // the serialized argument values and can carry PII/secrets, so it is never logged here.
  private registerSlowQueryLogger(client: PrismaClient, thresholdMs: number): void {
    (client as unknown as PrismaQueryEventEmitter).$on('query', (event) => {
      if (!isSlowQuery(event.duration, thresholdMs)) return;
      this.logger.warn(
        { durationMs: event.duration, query: event.query },
        'Slow database query detected',
      );
    });
  }

  get db(): PrismaClient {
    return this._writeClient;
  }

  get dbRead(): PrismaClient {
    return this._readClient;
  }

  get hasReplica(): boolean {
    return this._hasReplica;
  }

  // Always on primary — replicas can't coordinate interactive transactions (write serialization).
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
      throw new Error(`DatabaseModule: failed to connect — ${String(err)}`, { cause: err });
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this._writeClient.$disconnect();
      if (this._hasReplica) await this._readClient.$disconnect();
      this.logger.log('Database connection closed');
    } catch (err) {
      this.logger.error('DatabaseModule: error during disconnect', String(err));
    }
  }
}
