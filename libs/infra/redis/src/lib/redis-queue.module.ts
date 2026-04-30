import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_QUEUE_HOST', 'localhost'),
          port: config.get<number>('REDIS_QUEUE_PORT', 6380),
          // Reconnect strategy: exponential back-off up to 3 s, give up after
          // 10 retries.  BullMQ wraps ioredis; ioredis uses a callback that
          // returns a delay in ms or an Error to stop retrying.
          maxRetriesPerRequest: null, // required by BullMQ — do not remove
          // ioredis retryStrategy: return null to stop retrying, or a delay
          // in ms to schedule the next reconnect attempt.
          retryStrategy: (times: number): number | null =>
            times >= 10 ? null : Math.min(times * 200, 3000),
        },
        // Prefix isolates all BullMQ keys from other Redis consumers.
        // Override via REDIS_QUEUE_PREFIX (e.g., per-env: "myapp:prod").
        prefix: config.get<string>('REDIS_QUEUE_PREFIX', 'bull'),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          // Keep the 100 most-recent successes and 500 most-recent failures for
          // post-mortem inspection; age cap of 24 h prevents unbounded growth.
          removeOnComplete: { count: 100, age: 24 * 3600 },
          removeOnFail: { count: 500, age: 7 * 24 * 3600 },
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class RedisQueueModule {}
