import { describe, it, expect } from 'vitest';
import { redisReconnectStrategy } from './redis-reconnect';

describe('redisReconnectStrategy', () => {
  // ioredis stops reconnecting for good on a non-number, stranding every feature behind the client
  // after any outage. This must never return anything but a positive, finite delay.
  it('always returns a positive finite number, however many attempts have failed', () => {
    for (const attempt of [1, 2, 9, 10, 11, 100, 10_000]) {
      const delay = redisReconnectStrategy(attempt);
      expect(typeof delay, `attempt ${attempt} must yield a retry delay`).toBe('number');
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
    }
  });

  it('backs off linearly then holds at the 3s cap', () => {
    expect(redisReconnectStrategy(1)).toBe(200);
    expect(redisReconnectStrategy(5)).toBe(1000);
    expect(redisReconnectStrategy(15)).toBe(3000);
    expect(redisReconnectStrategy(1000)).toBe(3000);
  });
});
