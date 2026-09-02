import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { safeErrorSummary } from '@nestjs-fastify-nx/shared';

export const LEASE_TTL_MS = 30_000;
export const LEASE_RENEW_INTERVAL_MS = 10_000;

// Extend only while we still own the lease — a stalled holder must never steal it back from a
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

export interface RedisLeaderLeaseOptions {
  readonly redis: Redis;
  readonly key: string;
  // Called on every true → false transition (renew lost, acquire failed, Redis error, shutdown).
  // Holders of global state — Prometheus gauges above all — must clear it here: a replica that stops
  // being the single writer keeps exporting its last value forever otherwise, so a scrape of the old
  // and new leader together reports the metric twice.
  readonly onLeadershipLost?: () => void;
  readonly onError?: (message: string) => void;
}

/**
 * Single-writer lease over one Redis key, shared by every "exactly one replica should do this"
 * concern (Prometheus collector leader, scheduler cron leader).
 *
 * Best-effort, NOT a correctness-critical lock. A brief split-brain during failover is acceptable
 * for the workloads that use it, so a single Redis with compare-and-extend is sufficient — no
 * Redlock quorum. Callers that need mutual exclusion for correctness must not use this.
 *
 * The owner drives the ticking (`start`/`stop`) so it can bind the lifecycle to its own Nest hooks.
 */
export class RedisLeaderLease {
  private readonly token = randomUUID();
  private readonly inFlightTicks = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;
  private leader = false;
  private stopped = false;

  constructor(private readonly options: RedisLeaderLeaseOptions) {}

  isLeader(): boolean {
    return this.leader;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), LEASE_RENEW_INTERVAL_MS);
    // Never keep the event loop alive just for the renew timer.
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled([...this.inFlightTicks]);
    try {
      if (this.leader) await this.release();
    } catch (err) {
      // The lease self-expires via TTL — a failed release costs at most LEASE_TTL_MS of downtime
      // before a successor can take over.
      this.options.onError?.(`leader lease release failed: ${safeErrorSummary(err)}`);
    } finally {
      this.setLeader(false);
    }
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    const run = this.runTick();
    this.inFlightTicks.add(run);
    try {
      await run;
    } finally {
      this.inFlightTicks.delete(run);
    }
  }

  private async runTick(): Promise<void> {
    try {
      if (this.leader) {
        const renewed = await this.options.redis.eval(
          RENEW_SCRIPT,
          1,
          this.options.key,
          this.token,
          String(LEASE_TTL_MS),
        );
        if (this.stopped || renewed === 1) return;
        this.setLeader(false);
      }

      const acquired = await this.options.redis.set(
        this.options.key,
        this.token,
        'PX',
        LEASE_TTL_MS,
        'NX',
      );
      if (this.stopped) {
        if (acquired === 'OK') await this.release();
        return;
      }
      this.setLeader(acquired === 'OK');
    } catch (err) {
      // Fail closed: drop leadership so a healthy replica takes over and we never double-write
      // while Redis is flaky. A gap during an outage beats an N× overcount.
      this.setLeader(false);
      this.options.onError?.(`leader election tick failed: ${safeErrorSummary(err)}`);
    }
  }

  private async release(): Promise<void> {
    await this.options.redis.eval(RELEASE_SCRIPT, 1, this.options.key, this.token);
  }

  private setLeader(next: boolean): void {
    const lost = this.leader && !next;
    this.leader = next;
    if (!lost) return;
    try {
      this.options.onLeadershipLost?.();
    } catch (err) {
      // A misbehaving cleanup callback must not abort the election loop.
      this.options.onError?.(`leadership-lost handler threw: ${safeErrorSummary(err)}`);
    }
  }
}
