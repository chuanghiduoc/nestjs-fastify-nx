import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the promise value when it settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok');
  });

  it('rejects with the original error when the promise rejects before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000)).rejects.toThrow('boom');
  });

  it('rejects with a labelled timeout error when the promise is too slow', async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => undefined); // never settles
    const raced = withTimeout(pending, 50, 'Health probe');
    const assertion = expect(raced).rejects.toThrow('Health probe timed out after 50ms');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('uses the default label when none is provided', async () => {
    vi.useFakeTimers();
    const raced = withTimeout(new Promise<string>(() => undefined), 10);
    const assertion = expect(raced).rejects.toThrow('Operation timed out after 10ms');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });
});
