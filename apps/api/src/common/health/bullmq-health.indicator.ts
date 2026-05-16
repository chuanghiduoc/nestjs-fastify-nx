import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { EnvConfig } from '../../config/env.validation';
import { QUEUE_NAMES } from '../../app/constants/queue.constants';

const PROBE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Clear the timer whether the probe wins or loses — without this the reject
  // closure keeps a reference alive until the timer fires, blocking clean shutdown.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Health probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Verifies BullMQ subsystem health by pinging the queue's Redis connection.
 * A healthy response means the queue Redis is reachable and BullMQ can enqueue
 * and dequeue jobs. If the queue Redis is up but workers crash, /health/ready
 * will still return 200 — that is by design: readiness gates traffic, not
 * worker compute capacity.
 */
@Injectable()
export class BullMqHealthIndicator extends HealthIndicator implements OnModuleDestroy {
  private readonly queue: Queue;

  constructor(config: ConfigService<EnvConfig, true>) {
    super();
    this.queue = new Queue(QUEUE_NAMES.EMAIL_NOTIFICATION, {
      connection: {
        host: config.get('REDIS_QUEUE_HOST', { infer: true }),
        port: config.get('REDIS_QUEUE_PORT', { infer: true }),
        // No retries during a health probe — fail fast.
        maxRetriesPerRequest: 1,
        connectTimeout: PROBE_TIMEOUT_MS,
        retryStrategy: () => null,
        lazyConnect: true,
      },
      prefix: config.get('REDIS_QUEUE_PREFIX', { infer: true }),
    });

    // Suppress unhandled ioredis error events so a transient Redis blip does
    // not crash the process — surfaced via isHealthy() instead.
    this.queue.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await withTimeout(
        this.queue.client.then((client) => client.ping()),
        PROBE_TIMEOUT_MS,
      );
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        `${key} check failed`,
        this.getStatus(key, false, { error: String(err) }),
      );
    }
  }
}
