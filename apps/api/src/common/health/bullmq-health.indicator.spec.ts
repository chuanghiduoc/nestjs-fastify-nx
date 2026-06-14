/// <reference types="vitest/globals" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthCheckError } from '@nestjs/terminus';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';

const { mockQueue } = vi.hoisted(() => ({
  mockQueue: {
    getJobCounts: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
  },
}));

vi.mock('bullmq', () => ({
  Queue: class {
    constructor() {
      return mockQueue;
    }
  },
}));

import { BullMqHealthIndicator } from './bullmq-health.indicator';

function buildConfig(): ConfigService<EnvConfig, true> {
  const values: Record<string, unknown> = {
    REDIS_QUEUE_HOST: 'localhost',
    REDIS_QUEUE_PORT: 6380,
    REDIS_QUEUE_PREFIX: 'bull',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<EnvConfig, true>;
}

describe('BullMqHealthIndicator', () => {
  let indicator: BullMqHealthIndicator;

  beforeEach(() => {
    vi.clearAllMocks();
    indicator = new BullMqHealthIndicator(buildConfig());
  });

  it('reports up when the queue responds', async () => {
    mockQueue.getJobCounts.mockResolvedValueOnce({ waiting: 0 });

    const result = await indicator.isHealthy('bullmq');

    expect(result['bullmq'].status).toBe('up');
    expect(mockQueue.getJobCounts).toHaveBeenCalledWith('waiting');
  });

  it('throws HealthCheckError when the queue probe fails', async () => {
    mockQueue.getJobCounts.mockRejectedValueOnce(new Error('redis down'));

    await expect(indicator.isHealthy('bullmq')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('closes the queue on shutdown', async () => {
    await indicator.onModuleDestroy();

    expect(mockQueue.close).toHaveBeenCalledTimes(1);
  });
});
