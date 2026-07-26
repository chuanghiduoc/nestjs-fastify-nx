import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@nestjs/common';
import type { WorkerHost } from '@nestjs/bullmq';
import { applyWorkerConcurrency } from './apply-worker-concurrency';

function makeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn() } as unknown as Logger;
}

function makeHost(worker: { concurrency: number } | undefined): WorkerHost {
  return { worker } as unknown as WorkerHost;
}

describe('applyWorkerConcurrency', () => {
  it('resizes the running worker when the validated value differs from the decorator seed', () => {
    const worker = { concurrency: 5 };
    const logger = makeLogger();

    applyWorkerConcurrency(makeHost(worker), 25, logger);

    expect(worker.concurrency).toBe(25);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('25'));
  });

  it('is a silent no-op when the seed already matches — the common container path', () => {
    const worker = { concurrency: 5 };
    const logger = makeLogger();

    applyWorkerConcurrency(makeHost(worker), 5, logger);

    expect(worker.concurrency).toBe(5);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // The BullMQ explorer assigns `host.worker` in its own onModuleInit; hook ordering between
  // providers is undefined, so a missing worker must degrade to the decorator value with a warning
  // rather than throwing and taking the whole process down at bootstrap.
  it('warns and leaves the decorator value in place when no worker is attached yet', () => {
    const logger = makeLogger();

    expect(() => applyWorkerConcurrency(makeHost(undefined), 25, logger)).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not attached'));
  });
});
