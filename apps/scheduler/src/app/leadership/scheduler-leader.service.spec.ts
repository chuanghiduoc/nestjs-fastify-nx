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

// Narrow, typed view onto the composed lease. The election mechanics themselves are covered by
// RedisLeaderLease's own spec; what matters here is that this service wires the right key and
// exposes the lease's state through the OutboxRelayLeadership contract.
const tick = (service: SchedulerLeaderService): Promise<void> =>
  (service as unknown as { lease: { tick(): Promise<void> } }).lease.tick();

describe('SchedulerLeaderService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('claims the prefixed scheduler lease key', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    const service = new SchedulerLeaderService(config(), redis);

    await tick(service);

    expect(redis.set).toHaveBeenCalledWith(
      'bull:scheduler:leader',
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX',
    );
    expect(service.isLeader()).toBe(true);
  });

  it('reports follower state while another replica holds the lease', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce(null);
    const service = new SchedulerLeaderService(config(), redis);

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
