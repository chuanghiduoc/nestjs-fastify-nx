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
import { RedisQueueClientProvider } from './redis-queue.module';

function buildConfig(): ConfigService {
  const map: Record<string, unknown> = {
    REDIS_QUEUE_HOST: '127.0.0.1',
    REDIS_QUEUE_PORT: 6379,
    REDIS_QUEUE_PREFIX: 'test',
  };
  return { get: (key: string) => map[key] } as unknown as ConfigService;
}

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
