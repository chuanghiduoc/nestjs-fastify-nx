import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { routeFailedJobToDlq, type DeadLetterEnvelope } from './dead-letter-router';

interface FakeJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  attemptsMade: number;
  opts?: { attempts?: number };
}

function buildSource(job: FakeJob | null): Queue {
  return {
    name: 'email-notification',
    getJob: vi.fn(async () => job),
  } as unknown as Queue;
}

function buildDlq(): Queue & { add: ReturnType<typeof vi.fn> } {
  const add = vi.fn(async () => ({ id: 'dlq-id' }));
  return {
    name: 'email-notification.dlq',
    add,
  } as unknown as Queue & { add: ReturnType<typeof vi.fn> };
}

function silentLogger(): Logger {
  const logger = new Logger('test');
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  return logger;
}

describe('routeFailedJobToDlq', () => {
  it('does nothing when the source queue cannot find the job', async () => {
    const source = buildSource(null);
    const dlq = buildDlq();

    await routeFailedJobToDlq(
      source,
      dlq,
      { jobId: 'missing', failedReason: 'gone' },
      silentLogger(),
    );

    expect(dlq.add).not.toHaveBeenCalled();
  });

  it('skips routing while attempts remain in the retry budget', async () => {
    const source = buildSource({
      id: 'job-1',
      name: 'welcome-email',
      data: { to: 'a@b.c' },
      attemptsMade: 1,
      opts: { attempts: 3 },
    });
    const dlq = buildDlq();

    await routeFailedJobToDlq(
      source,
      dlq,
      { jobId: 'job-1', failedReason: 'transient' },
      silentLogger(),
    );

    expect(dlq.add).not.toHaveBeenCalled();
  });

  it('routes to the DLQ once attemptsMade reaches the configured maximum', async () => {
    const source = buildSource({
      id: 'job-2',
      name: 'welcome-email',
      data: { to: 'a@b.c', subject: 'Welcome' },
      attemptsMade: 3,
      opts: { attempts: 3 },
    });
    const dlq = buildDlq();

    await routeFailedJobToDlq(
      source,
      dlq,
      { jobId: 'job-2', failedReason: 'permanent' },
      silentLogger(),
    );

    expect(dlq.add).toHaveBeenCalledOnce();
    const [name, payload, opts] = dlq.add.mock.calls[0];
    expect(name).toBe('welcome-email');
    const envelope = payload as DeadLetterEnvelope;
    expect(envelope.originalQueue).toBe('email-notification');
    expect(envelope.originalJobId).toBe('job-2');
    expect(envelope.originalJobName).toBe('welcome-email');
    expect(envelope.failedReason).toBe('permanent');
    expect(envelope.attemptsMade).toBe(3);
    expect(envelope.payload).toEqual({ to: 'a@b.c', subject: 'Welcome' });
    expect(typeof envelope.failedAt).toBe('string');
    expect(opts).toMatchObject({ jobId: 'dlq__job-2', attempts: 1 });
  });

  it('treats a missing opts.attempts as a single-attempt budget', async () => {
    const source = buildSource({
      id: 'job-3',
      name: 'welcome-email',
      data: {},
      attemptsMade: 1,
    });
    const dlq = buildDlq();

    await routeFailedJobToDlq(
      source,
      dlq,
      { jobId: 'job-3', failedReason: 'boom' },
      silentLogger(),
    );

    expect(dlq.add).toHaveBeenCalledOnce();
  });

  it('swallows downstream failures so a broken DLQ never blocks the source queue listener', async () => {
    const source = buildSource({
      id: 'job-4',
      name: 'welcome-email',
      data: {},
      attemptsMade: 3,
      opts: { attempts: 3 },
    });
    const dlq = buildDlq();
    dlq.add.mockRejectedValueOnce(new Error('redis offline'));

    await expect(
      routeFailedJobToDlq(
        source,
        dlq,
        { jobId: 'job-4', failedReason: 'permanent' },
        silentLogger(),
      ),
    ).resolves.toBeUndefined();
  });
});
