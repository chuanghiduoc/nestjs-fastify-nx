import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import { closeQueueQuietly, closeQuietly } from './close-quietly';

describe('closeQuietly', () => {
  it('calls quit() and does not fall back when it succeeds', async () => {
    const client = {
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
    } as unknown as Redis;

    await closeQuietly(client);

    expect(client.quit).toHaveBeenCalledOnce();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('falls back to disconnect() when quit() rejects', async () => {
    const client = {
      quit: vi.fn().mockRejectedValue(new Error('connection already closed')),
      disconnect: vi.fn(),
    } as unknown as Redis;

    await closeQuietly(client);

    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});

describe('closeQueueQuietly', () => {
  it('calls close() and does not fall back when it succeeds', async () => {
    const queue = {
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    } as unknown as Queue;

    await closeQueueQuietly(queue);

    expect(queue.close).toHaveBeenCalledOnce();
    expect(queue.disconnect).not.toHaveBeenCalled();
  });

  it('falls back to disconnect() when close() throws', async () => {
    const queue = {
      close: vi.fn().mockRejectedValue(new Error('close failed')),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;

    await closeQueueQuietly(queue);

    expect(queue.disconnect).toHaveBeenCalledOnce();
  });

  it('swallows a disconnect() failure after a failed close()', async () => {
    const queue = {
      close: vi.fn().mockRejectedValue(new Error('close failed')),
      disconnect: vi.fn().mockRejectedValue(new Error('disconnect failed too')),
    } as unknown as Queue;

    await expect(closeQueueQuietly(queue)).resolves.toBeUndefined();
  });
});
