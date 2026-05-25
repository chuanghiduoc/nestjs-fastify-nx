import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { EnvConfig } from '../../config/env.validation';
import { QUEUE_NAMES } from '../../app/constants/queue.constants';

const PROBE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Health probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class BullMqHealthIndicator extends HealthIndicator implements OnModuleDestroy {
  private readonly queue: Queue;

  constructor(config: ConfigService<EnvConfig, true>) {
    super();
    this.queue = new Queue(QUEUE_NAMES.EMAIL_NOTIFICATION, {
      connection: {
        host: config.get('REDIS_QUEUE_HOST', { infer: true }),
        port: config.get('REDIS_QUEUE_PORT', { infer: true }),
        maxRetriesPerRequest: 1,
        connectTimeout: PROBE_TIMEOUT_MS,
        retryStrategy: () => null,
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
    try {
      // getJobCounts exercises the queue end-to-end (Redis connection + prefix
      // + queue key lookup) without touching BullMQ's IRedisClient internals —
      // 5.77.x narrowed that type so `ping` is no longer publicly exposed.
      await withTimeout(this.queue.getJobCounts('waiting'), PROBE_TIMEOUT_MS);
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        `${key} check failed`,
        this.getStatus(key, false, { error: String(err) }),
      );
    }
  }
}
