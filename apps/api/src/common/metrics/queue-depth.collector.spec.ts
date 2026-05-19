import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueDepthCollector } from './queue-depth.collector';
import type { MetricsService } from './metrics.service';
import type { Queue } from 'bullmq';

function makeMockQueue(name: string, counts: Record<string, number>): Queue {
  return {
    name,
    getJobCounts: vi.fn().mockResolvedValue(counts),
  } as unknown as Queue;
}

function makeMockMetrics(): MetricsService {
  const set = vi.fn();
  return {
    bullmqQueueDepth: {
      labels: vi.fn().mockReturnValue({ set }),
    },
  } as unknown as MetricsService;
}

describe('QueueDepthCollector', () => {
  let emailQ: Queue;
  let uploadQ: Queue;
  let metrics: MetricsService;
  let collector: QueueDepthCollector;

  const EMAIL_COUNTS = { waiting: 5, active: 2, completed: 100, failed: 1, delayed: 0 };
  const UPLOAD_COUNTS = { waiting: 0, active: 1, completed: 50, failed: 0, delayed: 3 };

  beforeEach(() => {
    emailQ = makeMockQueue('email-notification', EMAIL_COUNTS);
    uploadQ = makeMockQueue('upload-verification', UPLOAD_COUNTS);
    metrics = makeMockMetrics();
    collector = new QueueDepthCollector(emailQ, uploadQ, metrics);
  });

  it('calls getJobCounts for every requested state on both queues', async () => {
    await collector.collect();

    expect(emailQ.getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    expect(uploadQ.getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
  });

  it('sets gauge with correct queue and state labels for the email queue', async () => {
    await collector.collect();

    for (const [state, n] of Object.entries(EMAIL_COUNTS)) {
      expect(metrics.bullmqQueueDepth.labels).toHaveBeenCalledWith('email-notification', state);
      // The set mock is on the object returned by labels() — verify the value indirectly
      // by confirming set was called with the right number for this combination.
      const setMock = vi
        .mocked(metrics.bullmqQueueDepth.labels)
        .mock.results.find((r) => r.value !== undefined)?.value as {
        set: ReturnType<typeof vi.fn>;
      };
      expect(setMock?.set).toHaveBeenCalledWith(n);
    }
  });

  it('sets gauge with correct queue and state labels for the upload queue', async () => {
    await collector.collect();

    for (const [state] of Object.entries(UPLOAD_COUNTS)) {
      expect(metrics.bullmqQueueDepth.labels).toHaveBeenCalledWith('upload-verification', state);
    }
  });

  it('does not throw when getJobCounts rejects — error is non-fatal', async () => {
    vi.mocked(emailQ.getJobCounts).mockRejectedValueOnce(new Error('Redis timeout'));

    // `collect()` returns Promise<void> and catches internally; assert it
    // resolved successfully. `.resolves.not.toThrow()` is not a valid Vitest
    // matcher — `.toThrow` is a function-call matcher and is not chainable
    // through `.resolves`. Earlier this silently passed regardless of outcome.
    await expect(collector.collect()).resolves.toBeUndefined();
    // upload queue still collected despite email failure
    expect(uploadQ.getJobCounts).toHaveBeenCalled();
  });

  it('continues collecting the upload queue when the email queue errors', async () => {
    vi.mocked(emailQ.getJobCounts).mockRejectedValueOnce(new Error('connection reset'));

    await collector.collect();

    // Upload queue labels were set despite email failure
    for (const [state] of Object.entries(UPLOAD_COUNTS)) {
      expect(metrics.bullmqQueueDepth.labels).toHaveBeenCalledWith('upload-verification', state);
    }
  });
});
