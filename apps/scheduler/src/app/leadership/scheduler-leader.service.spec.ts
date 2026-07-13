import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { SchedulerEnvConfig } from '../../config/env.validation';
import { SchedulerLeaderService } from './scheduler-leader.service';

function config(): ConfigService<SchedulerEnvConfig, true> {
  return { get: vi.fn(() => 'bull') } as unknown as ConfigService<SchedulerEnvConfig, true>;
}

function redisMock() {
  return {
    set: vi.fn(),
    eval: vi.fn(),
  } as unknown as Redis;
}

const tick = (service: SchedulerLeaderService): Promise<void> =>
  (service as unknown as { tick(): Promise<void> }).tick();

describe('SchedulerLeaderService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('acquires and renews an owner-token lease', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);
    const service = new SchedulerLeaderService(config(), redis);

    await tick(service);
    expect(service.isLeader()).toBe(true);

    await tick(service);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('pexpire'),
      1,
      'bull:scheduler:leader',
      expect.any(String),
      expect.any(String),
    );
    expect(service.isLeader()).toBe(true);
  });

  it('fails closed and relinquishes leadership on Redis errors', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    const service = new SchedulerLeaderService(config(), redis);
    await tick(service);

    vi.mocked(redis.eval).mockRejectedValueOnce(new Error('redis unavailable'));
    await tick(service);

    expect(service.isLeader()).toBe(false);
  });

  it('releases only its own lease on shutdown', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);
    const service = new SchedulerLeaderService(config(), redis);
    await tick(service);

    await service.onModuleDestroy();

    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('del'),
      1,
      'bull:scheduler:leader',
      expect.any(String),
    );
    expect(service.isLeader()).toBe(false);
  });
});
