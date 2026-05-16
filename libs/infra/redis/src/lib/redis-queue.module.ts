import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

interface RedisQueueEnv {
  REDIS_QUEUE_HOST: string;
  REDIS_QUEUE_PORT: number;
  REDIS_QUEUE_PREFIX: string;
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
          retryStrategy: (times: number): number | null =>
            times >= 10 ? null : Math.min(times * 200, 3000),
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
  exports: [BullModule],
})
export class RedisQueueModule {}
