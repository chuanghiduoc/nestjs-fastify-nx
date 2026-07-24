import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { FIXED_WINDOW_INCR_SCRIPT, redisFixedWindowIncr } from './redis-fixed-window';

function makeRedis(evalResult: unknown): Redis {
  return { eval: vi.fn().mockResolvedValue(evalResult) } as unknown as Redis;
}

describe('redisFixedWindowIncr', () => {
  it('passes the fixed-window script, key and window (ms) to EVAL', async () => {
    const redis = makeRedis([1, 60_000]);
    await redisFixedWindowIncr(redis, 'k', 60_000);
    expect(redis.eval).toHaveBeenCalledWith(FIXED_WINDOW_INCR_SCRIPT, 1, 'k', '60000');
  });

  it('coerces string replies (RESP2 returns integers as strings) to numbers', async () => {
    const redis = makeRedis(['3', '45000']);
    await expect(redisFixedWindowIncr(redis, 'k', 60_000)).resolves.toEqual({
      count: 3,
      ttlMs: 45_000,
    });
  });

  it('clamps a negative TTL (key with no expiry: PTTL === -1) to 0', async () => {
    const redis = makeRedis([2, -1]);
    await expect(redisFixedWindowIncr(redis, 'k', 60_000)).resolves.toEqual({ count: 2, ttlMs: 0 });
  });

  it('throws on a malformed count reply instead of granting an unbounded budget', async () => {
    const redis = makeRedis(['nope', 1000]);
    await expect(redisFixedWindowIncr(redis, 'k', 60_000)).rejects.toThrow(
      /Unexpected fixed-window counter reply/,
    );
  });
});
