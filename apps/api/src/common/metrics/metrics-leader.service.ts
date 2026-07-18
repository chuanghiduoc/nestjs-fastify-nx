import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { redisReconnectStrategy } from '@nestjs-fastify-nx/shared';
import Redis from 'ioredis';
import type { EnvConfig } from '../../config/env.validation';

// Global-state metrics (queue depth, outbox lag, BullMQ QueueEvents) describe ONE shared truth in
// Redis/Postgres. Every API replica observes the same stream, so if all of them record, gauges read
// N× the real value and counters inflate by the replica count. A single-writer lease fixes that:
// exactly one replica is the "collector leader" at a time; the rest observe but do not record.
//
// This is a best-effort lease, not a correctness-critical lock. A brief split-brain (two leaders for
// a few seconds during failover) only double-counts transiently — acceptable for metrics, so a single
// Redis with a compare-and-extend lease is sufficient (no Redlock quorum needed).
const LEASE_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

// Extend only while we still own the lease — a stalled replica must never steal it back from a
// successor that already acquired it.
const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

// Release only our own lease on shutdown — never delete a lease a successor now holds.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

@Injectable()
export class MetricsLeaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsLeaderService.name);
  private readonly redis: Redis;
  private readonly key: string;
  private readonly token = randomUUID();
  private timer?: NodeJS.Timeout;
  private leader = false;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.key = `${config.get('REDIS_QUEUE_PREFIX', { infer: true })}:metrics:collector-leader`;
    this.redis = new Redis({
      host: config.get('REDIS_QUEUE_HOST', { infer: true }),
      port: config.get('REDIS_QUEUE_PORT', { infer: true }),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: redisReconnectStrategy,
    });
    // Surfaced as leader=false on the next failed tick — never crash the process on a Redis blip.
    this.redis.on('error', () => undefined);
  }

  isLeader(): boolean {
    return this.leader;
  }

  async onModuleInit(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, RENEW_INTERVAL_MS);
    // Never keep the event loop alive just for the renew timer.
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    try {
      if (this.leader) {
        await this.redis.eval(RELEASE_SCRIPT, 1, this.key, this.token);
      }
    } catch {
      // Lease self-expires via TTL — nothing to clean up if release fails.
    } finally {
      this.leader = false;
      this.redis.disconnect();
    }
  }

  private async tick(): Promise<void> {
    try {
      if (this.leader) {
        const renewed = await this.redis.eval(
          RENEW_SCRIPT,
          1,
          this.key,
          this.token,
          String(LEASE_TTL_MS),
        );
        this.leader = renewed === 1;
        if (this.leader) return;
      }
      const acquired = await this.redis.set(this.key, this.token, 'PX', LEASE_TTL_MS, 'NX');
      this.leader = acquired === 'OK';
    } catch (err) {
      // Fail closed: drop leadership so a healthy replica takes over and we never double-count
      // while Redis is flaky. A metrics gap during an outage beats an N× overcount.
      this.leader = false;
      this.logger.warn(`collector leader election tick failed: ${String(err)}`);
    }
  }
}
