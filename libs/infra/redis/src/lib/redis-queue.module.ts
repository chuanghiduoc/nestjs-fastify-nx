import { Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * DI token for the shared ioredis client connected to the BullMQ Redis
 * instance. Injecting this avoids opening a second connection for
 * idempotency guards (e.g. SETNX email dedup key) that live in processors.
 *
 * Consumers inject `Redis` directly — the wrapper class is an implementation
 * detail; the token still resolves to the underlying ioredis instance.
 */
export const REDIS_QUEUE_CLIENT = 'REDIS_QUEUE_CLIENT';

interface RedisQueueEnv {
  REDIS_QUEUE_HOST: string;
  REDIS_QUEUE_PORT: number;
  REDIS_QUEUE_PREFIX: string;
}

const RECONNECT_DELAY_STEP_MS = 200;
const RECONNECT_DELAY_CAP_MS = 3000;

/**
 * Always returns a delay, never a non-number. ioredis treats a non-number return as "stop
 * reconnecting for good", which would strand workers permanently after any Redis outage that
 * outlasts the attempt budget — with no self-healing and no healthcheck tied to Redis liveness.
 * Bounding in-flight commands is `maxRetriesPerRequest`'s job, not this one's.
 */
export function queueRetryStrategy(times: number): number {
  return Math.min(times * RECONNECT_DELAY_STEP_MS, RECONNECT_DELAY_CAP_MS);
}

/**
 * Wraps the ioredis client used by processors for idempotency guards.
 * Registered as the `REDIS_QUEUE_CLIENT` token so consumers see `Redis`
 * directly; the wrapper exists solely to hook `OnModuleDestroy` and close
 * the socket on SIGTERM / test teardown — preventing fd leaks on rolling
 * deploys where the raw-factory pattern has no shutdown path.
 */
@Injectable()
export class RedisQueueClientProvider implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService<RedisQueueEnv, true>) {
    this.client = new Redis({
      host: config.get('REDIS_QUEUE_HOST', { infer: true }),
      port: config.get('REDIS_QUEUE_PORT', { infer: true }),
      maxRetriesPerRequest: null,
      retryStrategy: queueRetryStrategy,
      // lazyConnect prevents opening a socket until the first command —
      // importers that never call redis (e.g. health checks) pay no fd cost.
      lazyConnect: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<RedisQueueEnv, true>) => ({
        connection: {
          host: config.get('REDIS_QUEUE_HOST', { infer: true }),
          port: config.get('REDIS_QUEUE_PORT', { infer: true }),
          // BullMQ requires `maxRetriesPerRequest: null` — without it BullMQ
          // throws on every connection blip instead of letting ioredis retry.
          maxRetriesPerRequest: null,
          retryStrategy: queueRetryStrategy,
        },
        prefix: config.get('REDIS_QUEUE_PREFIX', { infer: true }),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          // Keep the 100 most-recent successes and 500 most-recent failures
          // for post-mortem; age cap prevents unbounded growth.
          removeOnComplete: { count: 100, age: 24 * 3600 },
          removeOnFail: { count: 500, age: 7 * 24 * 3600 },
        },
      }),
    }),
  ],
  providers: [
    RedisQueueClientProvider,
    {
      provide: REDIS_QUEUE_CLIENT,
      inject: [RedisQueueClientProvider],
      useFactory: (wrapper: RedisQueueClientProvider): Redis => wrapper.client,
    },
  ],
  exports: [BullModule, REDIS_QUEUE_CLIENT],
})
export class RedisQueueModule {}
