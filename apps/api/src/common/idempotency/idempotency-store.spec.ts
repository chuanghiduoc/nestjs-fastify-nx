import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { IdempotencyStore } from './idempotency-store';

describe('IdempotencyStore ownership', () => {
  it('uses the owner token for atomic completion', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(0),
    } as unknown as Redis;
    const store = new IdempotencyStore(redis, 60, 3600);
    const acquired = await store.acquire('idem:key', 'fingerprint');
    if (!acquired.acquired) throw new Error('expected lock acquisition');

    await expect(
      store.complete('idem:key', acquired.ownerToken, {
        fingerprint: 'fingerprint',
        status: 201,
        body: '{}',
      }),
    ).resolves.toBe(false);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'idem:key',
      acquired.ownerToken,
      expect.stringContaining('"state":"completed"'),
      '3600000',
    );
  });

  it('releases only through compare-and-delete', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(1) } as unknown as Redis;
    const store = new IdempotencyStore(redis, 60, 3600);

    await expect(store.release('idem:key', 'owner-a')).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'idem:key', 'owner-a');
  });
});
