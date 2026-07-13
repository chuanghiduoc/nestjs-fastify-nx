import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

export interface PendingIdempotencyRecord {
  state: 'pending';
  fingerprint: string;
  ownerToken: string;
}

export interface CompletedIdempotencyRecord {
  state: 'completed';
  fingerprint: string;
  status?: number;
  contentType?: string;
  body?: string;
}

export type IdempotencyRecord = PendingIdempotencyRecord | CompletedIdempotencyRecord;

export type AcquireResult =
  | { readonly acquired: true; readonly ownerToken: string }
  | { readonly acquired: false; readonly record: IdempotencyRecord };

const COMPLETE_IF_OWNER_SCRIPT = `
local current = redis.call('get', KEYS[1])
if not current then return 0 end
local record = cjson.decode(current)
if record.state ~= 'pending' or record.ownerToken ~= ARGV[1] then return 0 end
redis.call('set', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1`;

const RELEASE_IF_OWNER_SCRIPT = `
local current = redis.call('get', KEYS[1])
if not current then return 0 end
local record = cjson.decode(current)
if record.state ~= 'pending' or record.ownerToken ~= ARGV[1] then return 0 end
return redis.call('del', KEYS[1])`;

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
    const ownerToken = randomUUID();
    const pending: PendingIdempotencyRecord = { state: 'pending', fingerprint, ownerToken };
    const set = await this.redis.set(key, JSON.stringify(pending), 'PX', this.lockTtlMs, 'NX');
    if (set === 'OK') return { acquired: true, ownerToken };

    const raw = await this.redis.get(key);
    if (raw === null) {
      // Key expired between the failed NX and this GET. Report an in-progress conflict rather than
      // racing a second NX — a spurious 409 the client simply retries is safer than two requests
      // both believing they hold the lock.
      return { acquired: false, record: pending };
    }
    return { acquired: false, record: JSON.parse(raw) as IdempotencyRecord };
  }

  async complete(
    key: string,
    ownerToken: string,
    record: Omit<CompletedIdempotencyRecord, 'state'>,
  ): Promise<boolean> {
    const completed: CompletedIdempotencyRecord = { ...record, state: 'completed' };
    const result = await this.redis.eval(
      COMPLETE_IF_OWNER_SCRIPT,
      1,
      key,
      ownerToken,
      JSON.stringify(completed),
      String(this.recordTtlMs),
    );
    return result === 1;
  }

  async release(key: string, ownerToken: string): Promise<boolean> {
    const result = await this.redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, ownerToken);
    return result === 1;
  }
}
