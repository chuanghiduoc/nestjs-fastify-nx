import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BullMqMetricsListener } from './bullmq-metrics.listener';
import type { MetricsService } from './metrics.service';

function makeMockMetrics(): MetricsService {
  return {
    bullmqJobsTotal: { inc: vi.fn() },
    bullmqJobDurationSeconds: { observe: vi.fn() },
  } as unknown as MetricsService;
}

describe('BullMqMetricsListener', () => {
  let listener: BullMqMetricsListener;
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = makeMockMetrics();
    listener = new BullMqMetricsListener(metrics);
  });

  describe('job counter increments', () => {
    it('increments completed counter on completed event', () => {
      listener.onCompleted({ jobId: '1', returnvalue: '', prev: 'active' });
      expect(metrics.bullmqJobsTotal.inc).toHaveBeenCalledWith({
        queue: 'email-notification',
        status: 'completed',
      });
    });

    it('increments failed counter on failed event', () => {
      listener.onFailed({ jobId: '2', failedReason: 'SMTP error', prev: 'active' });
      expect(metrics.bullmqJobsTotal.inc).toHaveBeenCalledWith({
        queue: 'email-notification',
        status: 'failed',
      });
    });

    it('increments stalled counter on stalled event', () => {
      listener.onStalled();
      expect(metrics.bullmqJobsTotal.inc).toHaveBeenCalledWith({
        queue: 'email-notification',
        status: 'stalled',
      });
    });

    it('increments delayed counter on delayed event', () => {
      listener.onDelayed();
      expect(metrics.bullmqJobsTotal.inc).toHaveBeenCalledWith({
        queue: 'email-notification',
        status: 'delayed',
      });
    });
  });

  describe('duration histogram — active → completed', () => {
    it('emits a positive duration when active precedes completed on same replica', () => {
      listener.onActive({ jobId: 'job-a' });
      listener.onCompleted({ jobId: 'job-a', returnvalue: '', prev: 'active' });

      expect(metrics.bullmqJobDurationSeconds.observe).toHaveBeenCalledOnce();
      expect(metrics.bullmqJobDurationSeconds.observe).toHaveBeenCalledWith(
        { queue: 'email-notification', status: 'completed' },
        expect.any(Number),
      );
    });

    it('emits a positive duration when active precedes failed on same replica', () => {
      listener.onActive({ jobId: 'job-b' });
      listener.onFailed({ jobId: 'job-b', failedReason: 'timeout', prev: 'active' });

      expect(metrics.bullmqJobDurationSeconds.observe).toHaveBeenCalledOnce();
      expect(metrics.bullmqJobDurationSeconds.observe).toHaveBeenCalledWith(
        { queue: 'email-notification', status: 'failed' },
        expect.any(Number),
      );
    });

    it('clears the Map entry after completed so a re-queued job does not reuse stale timestamp', () => {
      listener.onActive({ jobId: 'job-c' });
      listener.onCompleted({ jobId: 'job-c', returnvalue: '', prev: 'active' });

      // Simulate BullMQ re-firing completed without a preceding active on this replica.
      vi.mocked(metrics.bullmqJobDurationSeconds.observe).mockClear();
      listener.onCompleted({ jobId: 'job-c', returnvalue: '', prev: 'active' });

      // No stale Map entry — duration must NOT be emitted.
      expect(metrics.bullmqJobDurationSeconds.observe).not.toHaveBeenCalled();
    });
  });

  describe('duration histogram — missing active (cross-replica scenario)', () => {
    it('skips duration observation when active was not seen on this replica', () => {
      // Only completed arrives — active was on a different API replica.
      listener.onCompleted({ jobId: 'job-x', returnvalue: '', prev: 'active' });

      // Counter is still incremented; histogram is skipped to avoid NaN sample.
      expect(metrics.bullmqJobsTotal.inc).toHaveBeenCalledWith({
        queue: 'email-notification',
        status: 'completed',
      });
      expect(metrics.bullmqJobDurationSeconds.observe).not.toHaveBeenCalled();
    });

    it('skips duration observation on failed when active was not seen on this replica', () => {
      listener.onFailed({ jobId: 'job-y', failedReason: 'err', prev: 'active' });

      expect(metrics.bullmqJobsTotal.inc).toHaveBeenCalledWith({
        queue: 'email-notification',
        status: 'failed',
      });
      expect(metrics.bullmqJobDurationSeconds.observe).not.toHaveBeenCalled();
    });
  });
});
