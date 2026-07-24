import type { Redis } from 'ioredis';

// Fixed-window counter shared by the credential-stuffing limiter (main.ts) and the Bull Board
// failed-auth budget. INCR the key, then PEXPIRE only on the FIRST hit so a burst cannot keep
// pushing the window deadline out; return the post-increment count and the remaining TTL.
export const FIXED_WINDOW_INCR_SCRIPT = `
local count = redis.call('incr', KEYS[1])
if count == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end
return {count, redis.call('pttl', KEYS[1])}`;

export interface FixedWindowState {
  count: number;
  ttlMs: number;
}

// Throws on a malformed count reply rather than silently granting an unbounded budget — callers
// decide whether that store failure should fail open or closed.
export async function redisFixedWindowIncr(
  redis: Redis,
  key: string,
  windowMs: number,
): Promise<FixedWindowState> {
  const [countRaw, ttlRaw] = (await redis.eval(
    FIXED_WINDOW_INCR_SCRIPT,
    1,
    key,
    String(windowMs),
  )) as [number | string, number | string];

  const count = Number(countRaw);
  if (!Number.isFinite(count)) {
    throw new Error(`Unexpected fixed-window counter reply: ${String(countRaw)}`);
  }
  const ttlMs = Number(ttlRaw);
  return { count, ttlMs: Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : 0 };
}
