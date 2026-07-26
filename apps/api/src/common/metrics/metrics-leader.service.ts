import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisReconnectStrategy } from '@nestjs-fastify-nx/shared';
import { RedisLeaderLease } from '@nestjs-fastify-nx/infra-redis';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

// Global-state metrics (queue depth, outbox lag, BullMQ QueueEvents) describe ONE shared truth in
// Redis/Postgres. Every API replica observes the same stream, so if all of them record, gauges read
// N× the real value and counters inflate by the replica count. A single-writer lease fixes that:
// exactly one replica is the "collector leader" at a time; the rest observe but do not record.
//
// The lease mechanics live in RedisLeaderLease (@nestjs-fastify-nx/infra-redis) — shared with the
// scheduler's cron leader rather than duplicated here.
@Injectable()
export class MetricsLeaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsLeaderService.name);
  private readonly redis: Redis;
  private readonly lease: RedisLeaderLease;
  // Registered by the collectors that own global-state gauges. Invoked on every loss of leadership.
  private readonly leadershipLostHandlers: Array<() => void> = [];

  constructor(config: ConfigService<EnvConfig, true>) {
    this.redis = new Redis({
      host: config.get('REDIS_QUEUE_HOST', { infer: true }),
      port: config.get('REDIS_QUEUE_PORT', { infer: true }),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: redisReconnectStrategy,
    });
    // Surfaced as leader=false on the next failed tick — never crash the process on a Redis blip.
    this.redis.on('error', () => undefined);

    this.lease = new RedisLeaderLease({
      redis: this.redis,
      key: `${config.get('REDIS_QUEUE_PREFIX', { infer: true })}:metrics:collector-leader`,
      onLeadershipLost: () => this.notifyLeadershipLost(),
      onError: (message) => this.logger.warn(`collector ${message}`),
    });
  }

  isLeader(): boolean {
    return this.lease.isLeader();
  }

  /**
   * Register a cleanup that runs whenever this replica stops being the collector leader.
   *
   * Gauges MUST use this. A gauge is last-write-wins per replica, so an ex-leader that simply stops
   * writing keeps exporting its final value forever: Prometheus then scrapes a stale series from the
   * old leader alongside the live one from the new leader, and `sum()` double-counts while `max()`
   * can pin to the frozen value. Counters do not need it — they stay individually monotonic, so
   * `rate()` across replicas remains correct.
   */
  onLeadershipLost(handler: () => void): void {
    this.leadershipLostHandlers.push(handler);
  }

  async onModuleInit(): Promise<void> {
    await this.lease.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.lease.stop();
    this.redis.disconnect();
  }

  private notifyLeadershipLost(): void {
    for (const handler of this.leadershipLostHandlers) {
      try {
        handler();
      } catch (err) {
        this.logger.warn(`collector leadership-lost handler failed: ${String(err)}`);
      }
    }
  }
}
