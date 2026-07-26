// Small inline semaphore — avoids pulling in a dependency (e.g. p-limit) for a single call site.
export class BoundedConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrent must be a positive integer');
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// Spreads a burst of tasks across the interval so the downstream call (Better Auth getSession)
// doesn't spike at a single instant. `signal` aborts the wait immediately so shutdown isn't held
// for up to a full interval by a socket that drew a near-max jitter.
//
// The abort listener is detached when the timer wins. Callers fan this out once per socket against
// ONE shared signal, so leaving them attached would grow the listener list for the whole cycle —
// and an EventTarget past its listener cap emits a MaxListenersExceededWarning on every round.
export function jitterDelay(maxMs: number, signal?: AbortSignal): Promise<void> {
  if (maxMs <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.random() * maxMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
