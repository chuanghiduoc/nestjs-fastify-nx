import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import {
  BullMqUploadVerificationDispatcher,
  verificationJobId,
} from './bullmq-upload-verification.dispatcher';

describe('verificationJobId', () => {
  it('is stable for retries and collision-resistant for delimiter variants', () => {
    expect(verificationJobId('users/a/b_c')).toBe(verificationJobId('users/a/b_c'));
    expect(verificationJobId('users/a/b_c')).not.toBe(verificationJobId('users/a_b/c'));
    expect(verificationJobId('users/a/b_c')).toMatch(/^verify__[a-f0-9]{64}$/);
  });

  // BullMQ rejects ':' in a custom job id at Job.validateOptions, and the failure surfaces
  // asynchronously inside a queue-event handler rather than at the call site.
  it('never contains the character BullMQ reserves', () => {
    expect(verificationJobId('files/a/b.png')).not.toContain(':');
  });
});

describe('BullMqUploadVerificationDispatcher', () => {
  it('enqueues a deduplicated job carrying the correlation id', async () => {
    const queue = { getJob: vi.fn().mockResolvedValue(undefined), add: vi.fn().mockResolvedValue(undefined) };
    const dispatcher = new BullMqUploadVerificationDispatcher(queue as unknown as Queue);

    await dispatcher.dispatch({
      key: 'files/u/f.png',
      declaredContentType: 'image/png',
      bucket: 'uploads',
      correlationId: 'corr-1',
    });

    expect(queue.add).toHaveBeenCalledWith(
      'verify-magic-bytes',
      expect.objectContaining({ correlationId: 'corr-1' }),
      expect.objectContaining({ jobId: verificationJobId('files/u/f.png'), attempts: 3 }),
    );
  });

  it('propagates an enqueue failure so confirm does not report success', async () => {
    const queue = { getJob: vi.fn().mockResolvedValue(undefined), add: vi.fn().mockRejectedValue(new Error('redis down')) };
    const dispatcher = new BullMqUploadVerificationDispatcher(queue as unknown as Queue);

    await expect(
      dispatcher.dispatch({ key: 'k', declaredContentType: 'image/png', bucket: 'b' }),
    ).rejects.toThrow('redis down');
  });
});

describe('verification recovery', () => {
  it.each(['completed', 'failed'])('retries a retained %s job instead of silently deduplicating it', async (state) => {
    const job = { getState: vi.fn().mockResolvedValue(state), retry: vi.fn().mockResolvedValue(undefined) };
    const queue = { getJob: vi.fn().mockResolvedValue(job), add: vi.fn() };
    await new BullMqUploadVerificationDispatcher(queue as unknown as Queue).dispatch({ key: 'k', declaredContentType: 'image/png', bucket: 'b' });
    expect(job.retry).toHaveBeenCalledWith(state);
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('leaves an active job with its current worker', async () => {
    const job = { getState: vi.fn().mockResolvedValue('active'), retry: vi.fn() };
    const queue = { getJob: vi.fn().mockResolvedValue(job), add: vi.fn() };
    await new BullMqUploadVerificationDispatcher(queue as unknown as Queue).dispatch({ key: 'k', declaredContentType: 'image/png', bucket: 'b' });
    expect(job.retry).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
