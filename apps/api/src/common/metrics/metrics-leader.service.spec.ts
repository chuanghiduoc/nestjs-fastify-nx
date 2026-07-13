import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = {
  set: vi.fn(),
  eval: vi.fn(),
  on: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('ioredis', () => ({
  // A constructor that returns an object replaces the `new` instance with our mock.
  default: class {
    constructor() {
      return redisMock;
    }
  },
}));

import { MetricsLeaderService } from './metrics-leader.service';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';

function makeConfig(): ConfigService<EnvConfig, true> {
  return {
    get: (key: string) => {
      switch (key) {
        case 'REDIS_QUEUE_PREFIX':
          return 'bull';
        case 'REDIS_QUEUE_HOST':
          return 'localhost';
        case 'REDIS_QUEUE_PORT':
          return 6380;
        default:
          return undefined;
      }
    },
  } as unknown as ConfigService<EnvConfig, true>;
}

const tick = (svc: MetricsLeaderService): Promise<void> =>
  (svc as unknown as { tick(): Promise<void> }).tick();

describe('MetricsLeaderService', () => {
  let svc: MetricsLeaderService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new MetricsLeaderService(makeConfig());
  });

  it('starts as a follower before any tick', () => {
    expect(svc.isLeader()).toBe(false);
  });

  it('becomes leader when the NX lease is acquired', async () => {
    redisMock.set.mockResolvedValueOnce('OK');

    await tick(svc);

    expect(svc.isLeader()).toBe(true);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining('metrics:collector-leader'),
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX',
    );
  });

  it('stays a follower when the lease is already held by another replica', async () => {
    redisMock.set.mockResolvedValueOnce(null);

    await tick(svc);

    expect(svc.isLeader()).toBe(false);
  });

  it('renews via compare-and-extend while leader, without re-acquiring', async () => {
    redisMock.set.mockResolvedValueOnce('OK');
    await tick(svc);

    redisMock.set.mockClear();
    redisMock.eval.mockResolvedValueOnce(1);
    await tick(svc);

    expect(redisMock.eval).toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
    expect(svc.isLeader()).toBe(true);
  });

  it('relinquishes leadership when the renew shows the lease was lost', async () => {
    redisMock.set.mockResolvedValueOnce('OK');
    await tick(svc);

    redisMock.eval.mockResolvedValueOnce(0);
    redisMock.set.mockResolvedValueOnce(null);
    await tick(svc);

    expect(svc.isLeader()).toBe(false);
  });

  it('fails closed (drops leadership) when Redis errors', async () => {
    redisMock.set.mockResolvedValueOnce('OK');
    await tick(svc);

    redisMock.eval.mockRejectedValueOnce(new Error('redis down'));
    await tick(svc);

    expect(svc.isLeader()).toBe(false);
  });

  it('releases only its own lease and disconnects on destroy', async () => {
    redisMock.set.mockResolvedValueOnce('OK');
    await tick(svc);

    redisMock.eval.mockResolvedValueOnce(1);
    await svc.onModuleDestroy();

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('del'),
      1,
      expect.any(String),
      expect.any(String),
    );
    expect(redisMock.disconnect).toHaveBeenCalled();
    expect(svc.isLeader()).toBe(false);
  });
});
