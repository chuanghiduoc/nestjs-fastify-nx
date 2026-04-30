import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Wraps PrismaClient with NestJS lifecycle hooks.
 *
 * Prisma v7 requires a driver adapter — `adapter` is a first-class field in
 * PrismaClientOptions (PrismaClientMutuallyExclusiveOptions), so no unsafe
 * cast is needed. Pool sizing and timeouts come from `DATABASE_*` env vars
 * so production can tune them per-deployment without code changes.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly _client: PrismaClient;

  constructor() {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL environment variable is not set');

    const adapter = new PrismaPg({
      connectionString: url,
      max: intEnv('DATABASE_POOL_MAX', 20),
      min: intEnv('DATABASE_POOL_MIN', 0),
      idleTimeoutMillis: intEnv('DATABASE_IDLE_TIMEOUT_MS', 10_000),
      connectionTimeoutMillis: intEnv('DATABASE_CONNECTION_TIMEOUT_MS', 5_000),
      statement_timeout: intEnv('DATABASE_STATEMENT_TIMEOUT_MS', 30_000),
      application_name: process.env['DATABASE_APPLICATION_NAME'] ?? 'nestjs-fastify-api',
    });

    this._client = new PrismaClient({ adapter });
  }

  get db(): PrismaClient {
    return this._client;
  }

  /**
   * Executes a callback inside a Prisma interactive transaction.
   * The `TransactionClient` type is derived directly from the $transaction
   * overload so it stays in sync with the installed Prisma version without
   * importing from internal runtime paths.
   */
  async transaction<R>(
    fn: (client: TransactionClient) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R> {
    return this._client.$transaction(fn, options);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this._client.$connect();
      this.logger.log('Database connection established');
    } catch (err) {
      // Re-throw so NestJS lifecycle manager surfaces the error and aborts
      // startup rather than silently running with a dead DB connection.
      throw new Error(`DatabaseModule: failed to connect — ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this._client.$disconnect();
      this.logger.log('Database connection closed');
    } catch (err) {
      // Log but don't re-throw; we are already shutting down.
      this.logger.error('DatabaseModule: error during disconnect', String(err));
    }
  }
}
