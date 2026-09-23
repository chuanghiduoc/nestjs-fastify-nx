import type { FastifyInstance } from 'fastify';
import type { Logger } from 'nestjs-pino';
import { closeQuietly } from '@nestjs-fastify-nx/infra-redis';
import { redisReconnectStrategy } from '@nestjs-fastify-nx/shared';
import Redis from 'ioredis';

export const REDIS_DB = {
  THROTTLER: 1,
  RATE_LIMIT: 4,
  IDEMPOTENCY: 5,
} as const;

interface ApiRedisConfig {
  readonly host: string;
  readonly port: number;
  readonly password?: string;
}

export function createApiRedis(config: ApiRedisConfig, db: number): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db,
    maxRetriesPerRequest: 1,
    retryStrategy: redisReconnectStrategy,
    enableOfflineQueue: false,
  });
}

export interface ManagedApiRedisOptions {
  readonly config: ApiRedisConfig;
  readonly db: number;
  readonly label: string;
}

export function createManagedApiRedis(
  fastify: FastifyInstance,
  logger: Logger,
  options: ManagedApiRedisOptions,
): Redis {
  const client = createApiRedis(options.config, options.db);
  client.on('error', (err: Error) => logger.warn({ err }, `${options.label} Redis error`));
  fastify.addHook('onClose', async () => {
    await closeQuietly(client);
  });
  return client;
}
