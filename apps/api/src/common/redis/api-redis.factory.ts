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
