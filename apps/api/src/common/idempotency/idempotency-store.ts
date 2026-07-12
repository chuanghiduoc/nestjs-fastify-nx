import type Redis from 'ioredis';

export type IdempotencyState = 'pending' | 'completed';

export interface IdempotencyRecord {
  state: IdempotencyState;
  fingerprint: string;
  status?: number;
  contentType?: string;
  body?: string;
}

export type AcquireResult =
  { readonly acquired: true } | { readonly acquired: false; readonly record: IdempotencyRecord };

// Redis-backed store for the idempotency plugin. `acquire` is the concurrency-safe primitive:
// `SET NX` is atomic, so exactly one of N concurrent requests sharing a key wins the lock; the
// losers read back the current record (pending → 409, completed → replay or mismatch).
export class IdempotencyStore {
  private readonly lockTtlMs: number;
  private readonly recordTtlMs: number;

  constructor(
    private readonly redis: Redis,
    lockTtlSeconds: number,
    recordTtlSeconds: number,
  ) {
    this.lockTtlMs = lockTtlSeconds * 1000;
    this.recordTtlMs = recordTtlSeconds * 1000;
  }

  async acquire(key: string, fingerprint: string): Promise<AcquireResult> {
    const pending: IdempotencyRecord = { state: 'pending', fingerprint };
    const set = await this.redis.set(key, JSON.stringify(pending), 'PX', this.lockTtlMs, 'NX');
    if (set === 'OK') return { acquired: true };

    const raw = await this.redis.get(key);
    if (raw === null) {
      // Key expired between the failed NX and this GET. Report an in-progress conflict rather than
      // racing a second NX — a spurious 409 the client simply retries is safer than two requests
      // both believing they hold the lock.
      return { acquired: false, record: pending };
    }
    return { acquired: false, record: JSON.parse(raw) as IdempotencyRecord };
  }

  async complete(key: string, record: Omit<IdempotencyRecord, 'state'>): Promise<void> {
    const completed: IdempotencyRecord = { ...record, state: 'completed' };
    await this.redis.set(key, JSON.stringify(completed), 'PX', this.recordTtlMs);
  }

  async release(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
