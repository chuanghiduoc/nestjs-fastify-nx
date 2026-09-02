import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { RedisLeaderLease } from './redis-leader-lease';

function redisMock() {
  return {
    set: vi.fn(),
    eval: vi.fn(),
  } as unknown as Redis;
}

describe('RedisLeaderLease', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts as a follower before any tick', () => {
    expect(new RedisLeaderLease({ redis: redisMock(), key: 'k' }).isLeader()).toBe(false);
  });

  it('becomes leader when the NX lease is acquired', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    const lease = new RedisLeaderLease({ redis, key: 'bull:scheduler:leader' });

    await lease.tick();

    expect(lease.isLeader()).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'bull:scheduler:leader',
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX',
    );
  });

  it('stays a follower when another replica already holds the lease', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce(null as never);
    const lease = new RedisLeaderLease({ redis, key: 'k' });

    await lease.tick();

    expect(lease.isLeader()).toBe(false);
  });

  it('renews via compare-and-extend while leader, without re-acquiring', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    const lease = new RedisLeaderLease({ redis, key: 'k' });
    await lease.tick();

    vi.mocked(redis.set).mockClear();
    vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);
    await lease.tick();

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('pexpire'),
      1,
      'k',
      expect.any(String),
      expect.any(String),
    );
    expect(redis.set).not.toHaveBeenCalled();
    expect(lease.isLeader()).toBe(true);
  });

  it('relinquishes leadership when the renew shows the lease was lost', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    const lease = new RedisLeaderLease({ redis, key: 'k' });
    await lease.tick();

    vi.mocked(redis.eval).mockResolvedValueOnce(0 as never);
    vi.mocked(redis.set).mockResolvedValueOnce(null as never);
    await lease.tick();

    expect(lease.isLeader()).toBe(false);
  });

  it('fails closed (drops leadership) when Redis errors', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    const onError = vi.fn();
    const lease = new RedisLeaderLease({ redis, key: 'k', onError });
    await lease.tick();

    vi.mocked(redis.eval).mockRejectedValueOnce(new Error('redis down'));
    await lease.tick();

    expect(lease.isLeader()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('leader election tick failed'));
  });

  it('releases only its own lease on stop', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce('OK');
    const lease = new RedisLeaderLease({ redis, key: 'k' });
    await lease.tick();

    vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);
    await lease.stop();

    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('del'),
      1,
      'k',
      expect.any(String),
    );
    expect(lease.isLeader()).toBe(false);
  });

  it('does not attempt a release when it never held the lease', async () => {
    const redis = redisMock();
    vi.mocked(redis.set).mockResolvedValueOnce(null as never);
    const lease = new RedisLeaderLease({ redis, key: 'k' });
    await lease.tick();

    await lease.stop();

    expect(redis.eval).not.toHaveBeenCalled();
  });

  describe('stop racing an in-flight tick', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    it('releases a lease acquired by a tick that completed after stop', async () => {
      const redis = redisMock();
      const acquire = deferred<'OK'>();
      vi.mocked(redis.set).mockReturnValueOnce(acquire.promise as never);
      vi.mocked(redis.eval).mockResolvedValue(1 as never);
      const lease = new RedisLeaderLease({ redis, key: 'k' });

      const ticking = lease.tick();
      const stopping = lease.stop();
      acquire.resolve('OK');
      await Promise.all([ticking, stopping]);

      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('del'),
        1,
        'k',
        expect.any(String),
      );
      expect(lease.isLeader()).toBe(false);
    });

    it('waits for an in-flight renew before releasing so the release cannot be overtaken', async () => {
      const redis = redisMock();
      vi.mocked(redis.set).mockResolvedValueOnce('OK');
      const lease = new RedisLeaderLease({ redis, key: 'k' });
      await lease.tick();

      const renew = deferred<number>();
      vi.mocked(redis.eval).mockReturnValueOnce(renew.promise as never);
      vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);

      const ticking = lease.tick();
      const stopping = lease.stop();
      renew.resolve(1);
      await Promise.all([ticking, stopping]);

      const calls = vi.mocked(redis.eval).mock.calls.map((call) => String(call[0]));
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain('pexpire');
      expect(calls[1]).toContain('del');
      expect(lease.isLeader()).toBe(false);
    });

    it('ignores a tick issued after stop', async () => {
      const redis = redisMock();
      const lease = new RedisLeaderLease({ redis, key: 'k' });
      await lease.stop();

      await lease.tick();

      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.eval).not.toHaveBeenCalled();
      expect(lease.isLeader()).toBe(false);
    });
  });

  describe('onLeadershipLost', () => {
    it('fires on every true → false transition', async () => {
      const redis = redisMock();
      const onLeadershipLost = vi.fn();
      const lease = new RedisLeaderLease({ redis, key: 'k', onLeadershipLost });

      vi.mocked(redis.set).mockResolvedValueOnce('OK');
      await lease.tick();
      expect(onLeadershipLost).not.toHaveBeenCalled();

      vi.mocked(redis.eval).mockResolvedValueOnce(0 as never);
      vi.mocked(redis.set).mockResolvedValueOnce(null as never);
      await lease.tick();

      expect(onLeadershipLost).toHaveBeenCalledOnce();
    });

    it('does not fire while leadership is merely retained', async () => {
      const redis = redisMock();
      const onLeadershipLost = vi.fn();
      const lease = new RedisLeaderLease({ redis, key: 'k', onLeadershipLost });

      vi.mocked(redis.set).mockResolvedValueOnce('OK');
      await lease.tick();
      vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);
      await lease.tick();

      expect(onLeadershipLost).not.toHaveBeenCalled();
    });

    it('does not fire repeatedly while already a follower', async () => {
      const redis = redisMock();
      const onLeadershipLost = vi.fn();
      const lease = new RedisLeaderLease({ redis, key: 'k', onLeadershipLost });

      vi.mocked(redis.set).mockResolvedValue(null as never);
      await lease.tick();
      await lease.tick();

      expect(onLeadershipLost).not.toHaveBeenCalled();
    });

    it('fires on stop so a shutting-down replica clears its global-state series', async () => {
      const redis = redisMock();
      const onLeadershipLost = vi.fn();
      const lease = new RedisLeaderLease({ redis, key: 'k', onLeadershipLost });
      vi.mocked(redis.set).mockResolvedValueOnce('OK');
      await lease.tick();

      vi.mocked(redis.eval).mockResolvedValueOnce(1 as never);
      await lease.stop();

      expect(onLeadershipLost).toHaveBeenCalledOnce();
    });

    it('keeps the election loop alive when the handler throws', async () => {
      const redis = redisMock();
      const onError = vi.fn();
      const lease = new RedisLeaderLease({
        redis,
        key: 'k',
        onLeadershipLost: () => {
          throw new Error('gauge reset exploded');
        },
        onError,
      });
      vi.mocked(redis.set).mockResolvedValueOnce('OK');
      await lease.tick();

      vi.mocked(redis.eval).mockResolvedValueOnce(0 as never);
      vi.mocked(redis.set).mockResolvedValueOnce('OK');
      await expect(lease.tick()).resolves.toBeUndefined();

      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining('leadership-lost handler threw'),
      );
      expect(lease.isLeader()).toBe(true);
    });
  });
});
