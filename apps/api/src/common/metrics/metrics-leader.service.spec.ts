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

// Narrow, typed view onto the composed lease. Election mechanics are covered by RedisLeaderLease's
// own spec; this file covers what the service adds on top — the key, and the leadership-lost fan-out
// that gauge owners depend on.
const tick = (svc: MetricsLeaderService): Promise<void> =>
  (svc as unknown as { lease: { tick(): Promise<void> } }).lease.tick();

describe('MetricsLeaderService', () => {
  let svc: MetricsLeaderService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new MetricsLeaderService(makeConfig());
  });

  it('starts as a follower before any tick', () => {
    expect(svc.isLeader()).toBe(false);
  });

  it('claims the prefixed collector-leader key', async () => {
    redisMock.set.mockResolvedValueOnce('OK');

    await tick(svc);

    expect(svc.isLeader()).toBe(true);
    expect(redisMock.set).toHaveBeenCalledWith(
      'bull:metrics:collector-leader',
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX',
    );
  });

  it('reports follower state while another replica holds the lease', async () => {
    redisMock.set.mockResolvedValueOnce(null);

    await tick(svc);

    expect(svc.isLeader()).toBe(false);
  });

  it('releases its own lease and disconnects on destroy', async () => {
    redisMock.set.mockResolvedValueOnce('OK');
    await tick(svc);

    redisMock.eval.mockResolvedValueOnce(1);
    await svc.onModuleDestroy();

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('del'),
      1,
      'bull:metrics:collector-leader',
      expect.any(String),
    );
    expect(redisMock.disconnect).toHaveBeenCalled();
    expect(svc.isLeader()).toBe(false);
  });

  describe('onLeadershipLost', () => {
    it('notifies every registered handler when the lease is lost', async () => {
      const first = vi.fn();
      const second = vi.fn();
      svc.onLeadershipLost(first);
      svc.onLeadershipLost(second);

      redisMock.set.mockResolvedValueOnce('OK');
      await tick(svc);
      expect(first).not.toHaveBeenCalled();

      redisMock.eval.mockResolvedValueOnce(0);
      redisMock.set.mockResolvedValueOnce(null);
      await tick(svc);

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
    });

    it('still runs the remaining handlers when one throws', async () => {
      const survivor = vi.fn();
      svc.onLeadershipLost(() => {
        throw new Error('reset exploded');
      });
      svc.onLeadershipLost(survivor);

      redisMock.set.mockResolvedValueOnce('OK');
      await tick(svc);
      redisMock.eval.mockResolvedValueOnce(0);
      redisMock.set.mockResolvedValueOnce(null);
      await tick(svc);

      expect(survivor).toHaveBeenCalledOnce();
      expect(svc.isLeader()).toBe(false);
    });
  });
});
