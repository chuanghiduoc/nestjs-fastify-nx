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
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
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
    const queue = { add: vi.fn().mockRejectedValue(new Error('redis down')) };
    const dispatcher = new BullMqUploadVerificationDispatcher(queue as unknown as Queue);

    await expect(
      dispatcher.dispatch({ key: 'k', declaredContentType: 'image/png', bucket: 'b' }),
    ).rejects.toThrow('redis down');
  });
});
