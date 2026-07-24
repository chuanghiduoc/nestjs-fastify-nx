/// <reference types="vitest/globals" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';

const { mockRedisClient, redisConstructorCalls } = vi.hoisted(() => ({
  mockRedisClient: {
    ping: vi.fn(),
    on: vi.fn(),
    disconnect: vi.fn(),
  },
  redisConstructorCalls: [] as unknown[],
}));

vi.mock('ioredis', () => ({
  default: class {
    constructor(...args: unknown[]) {
      redisConstructorCalls.push(args[0]);
      return mockRedisClient;
    }
  },
}));

import { RedisCacheHealthIndicator, RedisQueueHealthIndicator } from './redis.health';

function buildConfig(): ConfigService<EnvConfig, true> {
  const values: Record<string, unknown> = {
    REDIS_CACHE_HOST: 'cache-host',
    REDIS_CACHE_PORT: 6379,
    REDIS_QUEUE_HOST: 'queue-host',
    REDIS_QUEUE_PORT: 6380,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<EnvConfig, true>;
}

describe('RedisCacheHealthIndicator', () => {
  let indicator: RedisCacheHealthIndicator;

  beforeEach(() => {
    vi.clearAllMocks();
    redisConstructorCalls.length = 0;
    indicator = new RedisCacheHealthIndicator(new HealthIndicatorService(), buildConfig());
  });

  it('wires the cache host/port (not the queue ones) into the underlying client', () => {
    expect(redisConstructorCalls[0]).toMatchObject({ host: 'cache-host', port: 6379 });
  });

  it('reports up when PING replies PONG', async () => {
    mockRedisClient.ping.mockResolvedValueOnce('PONG');

    const result = await indicator.isHealthy('redis');

    expect(result['redis'].status).toBe('up');
  });

  it('reports down when PING replies with an unexpected value', async () => {
    mockRedisClient.ping.mockResolvedValueOnce('WRONG');

    const result = await indicator.isHealthy('redis');

    expect(result['redis']).toMatchObject({
      status: 'down',
      message: expect.stringContaining('ping returned WRONG'),
    });
  });

  it('reports down when PING rejects', async () => {
    mockRedisClient.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await indicator.isHealthy('redis');

    expect(result['redis']).toMatchObject({ status: 'down', message: 'redis check failed' });
  });

  it('reports down when the probe hangs past the timeout instead of hanging forever', async () => {
    vi.useFakeTimers();
    try {
      mockRedisClient.ping.mockImplementationOnce(() => new Promise(() => undefined));

      const resultPromise = indicator.isHealthy('redis');
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await resultPromise;

      expect(result['redis']).toMatchObject({ status: 'down', message: 'redis check failed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('disconnects the underlying client on module destroy', () => {
    indicator.onModuleDestroy();

    expect(mockRedisClient.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('RedisQueueHealthIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisConstructorCalls.length = 0;
  });

  it('wires the queue host/port (not the cache ones) into the underlying client', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- constructed for its side effect
    const indicator = new RedisQueueHealthIndicator(new HealthIndicatorService(), buildConfig());

    expect(redisConstructorCalls[0]).toMatchObject({ host: 'queue-host', port: 6380 });
  });
});
