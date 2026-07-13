import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailNotificationMetricsListener,
  UploadVerificationMetricsListener,
} from './bullmq-metrics.listener';
import type { MetricsService } from './metrics.service';
import type { MetricsLeaderService } from './metrics-leader.service';

function makeMockMetrics(): MetricsService {
  return {
    bullmqJobsTotal: { inc: vi.fn() },
    bullmqJobDurationSeconds: { observe: vi.fn() },
  } as unknown as MetricsService;
}

function makeLeader(isLeader: boolean): MetricsLeaderService {
  return { isLeader: () => isLeader } as unknown as MetricsLeaderService;
}

describe('EmailNotificationMetricsListener', () => {
  let listener: EmailNotificationMetricsListener;
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = makeMockMetrics();
    listener = new EmailNotificationMetricsListener(metrics, makeLeader(true));
  });

  describe('collector-leader gating', () => {
    it('records nothing when this replica is not the leader', () => {
      const follower = new EmailNotificationMetricsListener(metrics, makeLeader(false));

      follower.onActive({ jobId: 'j' });
      follower.onCompleted({ jobId: 'j', returnvalue: '', prev: 'active' });
      follower.onFailed({ jobId: 'j', failedReason: 'x', prev: 'active' });
      follower.onStalled({ jobId: 'j' });
      follower.onDelayed();

      expect(metrics.bullmqJobsTotal.inc).not.toHaveBeenCalled();
      expect(metrics.bullmqJobDurationSeconds.observe).not.toHaveBeenCalled();
    });
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
      listener.onStalled({ jobId: 'stalled-1' });
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

describe('UploadVerificationMetricsListener', () => {
  let listener: UploadVerificationMetricsListener;
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = makeMockMetrics();
    listener = new UploadVerificationMetricsListener(metrics, makeLeader(true));
  });

  it('tags counters with upload-verification queue label', () => {
    listener.onCompleted({ jobId: 'u1', returnvalue: '', prev: 'active' });
    expect(metrics.bullmqJobsTotal.inc).toHaveBeenCalledWith({
      queue: 'upload-verification',
      status: 'completed',
    });
  });

  it('tags duration histogram with upload-verification queue label', () => {
    listener.onActive({ jobId: 'u2' });
    listener.onCompleted({ jobId: 'u2', returnvalue: '', prev: 'active' });
    expect(metrics.bullmqJobDurationSeconds.observe).toHaveBeenCalledWith(
      { queue: 'upload-verification', status: 'completed' },
      expect.any(Number),
    );
  });
});
