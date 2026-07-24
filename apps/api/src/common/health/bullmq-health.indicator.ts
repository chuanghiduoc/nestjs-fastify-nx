import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { redisReconnectStrategy, withTimeout } from '@nestjs-fastify-nx/shared';
import type { EnvConfig } from '../../config/env.validation';
import { QUEUE_NAMES } from '../../app/constants/queue.constants';

const PROBE_TIMEOUT_MS = 2_000;
// Sanitized marker — Redis/BullMQ internals (host, prefix, key names) must not leak into the
// public /health/dependencies response. Raw cause is logged server-side instead.
const SANITIZED_ERROR = 'probe_failed';

@Injectable()
export class BullMqHealthIndicator implements OnModuleDestroy {
  private readonly queue: Queue;
  private readonly logger = new Logger(BullMqHealthIndicator.name);

  constructor(
    private readonly healthIndicator: HealthIndicatorService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.queue = new Queue(QUEUE_NAMES.EMAIL_NOTIFICATION, {
      connection: {
        host: config.get('REDIS_QUEUE_HOST', { infer: true }),
        port: config.get('REDIS_QUEUE_PORT', { infer: true }),
        maxRetriesPerRequest: 1,
        connectTimeout: PROBE_TIMEOUT_MS,
        // A number, not null: null makes ioredis give up reconnecting for good, so one Redis blip
        // would leave this probe reporting down forever. The timeouts above bound each probe call.
        retryStrategy: redisReconnectStrategy,
        lazyConnect: true,
      },
      prefix: config.get('REDIS_QUEUE_PREFIX', { infer: true }),
    });

    this.queue.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicator.check(key);
    try {
      // getJobCounts exercises the queue end-to-end (Redis connection + prefix
      // + queue key lookup) without touching BullMQ's IRedisClient internals —
      // 5.77.x narrowed that type so `ping` is no longer publicly exposed.
      await withTimeout(this.queue.getJobCounts('waiting'), PROBE_TIMEOUT_MS, 'Health probe');
      return indicator.up();
    } catch (err) {
      this.logger.warn(`bullmq readiness probe failed: ${String(err)}`);
      return indicator.down({ error: SANITIZED_ERROR });
    }
  }
}
