import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';

// ioredis is intercepted before the module-under-test loads so `new Redis()`
// returns a controllable stub — no real TCP connections in unit tests.
vi.mock('ioredis', () => {
  class MockRedis {
    // Each instance gets its own spy so tests are isolated.
    quit = vi.fn().mockResolvedValue('OK');
    disconnect = vi.fn();
  }
  return { default: MockRedis };
});

// Import AFTER the mock is registered.
import { RedisQueueClientProvider, queueRetryStrategy } from './redis-queue.module';

function buildConfig(): ConfigService {
  const map: Record<string, unknown> = {
    REDIS_QUEUE_HOST: '127.0.0.1',
    REDIS_QUEUE_PORT: 6379,
    REDIS_QUEUE_PREFIX: 'test',
  };
  return { get: (key: string) => map[key] } as unknown as ConfigService;
}

describe('queueRetryStrategy', () => {
  // ioredis stops reconnecting for good on a non-number, stranding the queue after any outage.
  it('always returns a number, however many attempts have failed', () => {
    for (const attempt of [1, 2, 9, 10, 11, 100, 10_000]) {
      const delay = queueRetryStrategy(attempt);
      expect(typeof delay, `attempt ${attempt} must yield a retry delay`).toBe('number');
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
    }
  });

  it('backs off linearly then holds at the 3s cap', () => {
    expect(queueRetryStrategy(1)).toBe(200);
    expect(queueRetryStrategy(5)).toBe(1000);
    expect(queueRetryStrategy(15)).toBe(3000);
    expect(queueRetryStrategy(1000)).toBe(3000);
  });
});

describe('RedisQueueClientProvider', () => {
  let provider: RedisQueueClientProvider;

  beforeEach(() => {
    // Cast through `never` — ConfigService generic params are irrelevant for
    // unit-test purposes; the mock returns the right values for every key.
    provider = new RedisQueueClientProvider(buildConfig() as never);
  });

  it('exposes an ioredis client via .client', () => {
    expect(provider.client).toBeDefined();
  });

  it('calls quit() exactly once on onModuleDestroy', async () => {
    await provider.onModuleDestroy();

    // Cast through unknown: the real Redis type and the mock type do not
    // overlap structurally, so a direct cast would be a TS error.
    const quitMock = (provider.client as unknown as { quit: ReturnType<typeof vi.fn> }).quit;
    expect(quitMock).toHaveBeenCalledOnce();
  });

  it('swallows quit() errors so a broken Redis never blocks Nest shutdown', async () => {
    // Simulate ioredis throwing when the connection is already closed.
    const quitMock = (provider.client as unknown as { quit: ReturnType<typeof vi.fn> }).quit;
    quitMock.mockRejectedValueOnce(new Error('Connection is already closed'));

    await expect(provider.onModuleDestroy()).resolves.toBeUndefined();
    const disconnectMock = (provider.client as unknown as { disconnect: ReturnType<typeof vi.fn> })
      .disconnect;
    expect(disconnectMock).toHaveBeenCalledOnce();
  });
});
