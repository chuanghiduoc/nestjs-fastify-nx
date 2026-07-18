import { describe, expect, it, vi } from 'vitest';
import { BoundedConcurrencyLimiter, jitterDelay } from './bounded-concurrency';

describe('BoundedConcurrencyLimiter', () => {
  it('never runs more than maxConcurrent tasks at once', async () => {
    const limiter = new BoundedConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;

    const task = async (): Promise<void> => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };

    await Promise.all(Array.from({ length: 10 }, () => limiter.run(task)));

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('runs every queued task exactly once, including after an earlier task rejects', async () => {
    const limiter = new BoundedConcurrencyLimiter(1);
    const completed: number[] = [];

    const tasks = [0, 1, 2, 3].map((i) =>
      limiter
        .run(async () => {
          if (i === 1) throw new Error('task failed');
          completed.push(i);
        })
        .catch(() => undefined),
    );

    await Promise.all(tasks);

    expect(completed).toEqual([0, 2, 3]);
  });

  it('rejects a non-positive concurrency limit', () => {
    expect(() => new BoundedConcurrencyLimiter(0)).toThrow();
  });
});

describe('jitterDelay', () => {
  it('resolves without scheduling a timer when maxMs is zero', async () => {
    await expect(jitterDelay(0)).resolves.toBeUndefined();
  });

  it('resolves once the scheduled timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.fn();
      jitterDelay(1000).then(spy);

      await vi.advanceTimersByTimeAsync(1000);

      expect(spy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(jitterDelay(60_000, controller.signal)).resolves.toBeUndefined();
  });

  it('resolves early and clears the timer when aborted mid-wait', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const spy = vi.fn();
      jitterDelay(60_000, controller.signal).then(spy);

      controller.abort();
      await Promise.resolve();
      expect(spy).toHaveBeenCalled();

      // No pending timer survives the abort — advancing time triggers nothing further.
      const pending = vi.getTimerCount();
      expect(pending).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
