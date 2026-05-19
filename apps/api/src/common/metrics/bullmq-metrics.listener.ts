import { OnQueueEvent, QueueEventsHost, QueueEventsListener } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { MetricsService } from './metrics.service';

interface ActiveEvent {
  jobId: string;
  prev?: string;
}

interface CompletedEvent {
  jobId: string;
  returnvalue: string;
  prev?: string;
}

interface FailedEvent {
  jobId: string;
  failedReason: string;
  prev?: string;
}

/**
 * Shared base class — one concrete subclass per queue carries the
 * `@QueueEventsListener(<queue>)` decorator (BullMQ requires a literal queue
 * name at decoration time, so a single listener cannot multiplex). Subclasses
 * pass their queue label to the base so all counters/histograms are tagged
 * with the producing queue.
 *
 * QueueEvents is built on a Redis stream with fan-out semantics — every
 * subscriber receives every event. Duration is measured via an in-process
 * Map: `active` records `Date.now()`, `completed`/`failed` compute the delta
 * and clear the entry.
 *
 * Caveat under horizontal scaling: when `API_REPLICAS > 1`, every replica
 * receives every event, so `bullmqJobsTotal` and `bullmqJobDurationSeconds`
 * sample counts are multiplied by the replica count. Rates and totals derived
 * from these series must be divided by the replica count in dashboards, or
 * the listener should be hoisted to a single leader-elected collector before
 * relying on them for SLOs. Duration mean/percentiles remain accurate because
 * each individual sample is correct.
 */
abstract class QueueMetricsListenerBase extends QueueEventsHost {
  /** jobId → unix ms when the active event arrived on this replica. */
  private readonly activeAt = new Map<string, number>();

  constructor(
    private readonly metrics: MetricsService,
    private readonly queueLabel: string,
  ) {
    super();
  }

  @OnQueueEvent('active')
  onActive(args: ActiveEvent): void {
    this.activeAt.set(args.jobId, Date.now());
  }

  @OnQueueEvent('completed')
  onCompleted(args: CompletedEvent): void {
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'completed' });
    this.observeDuration(args.jobId, 'completed');
  }

  @OnQueueEvent('failed')
  onFailed(args: FailedEvent): void {
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'failed' });
    this.observeDuration(args.jobId, 'failed');
  }

  @OnQueueEvent('stalled')
  onStalled(): void {
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'stalled' });
  }

  @OnQueueEvent('delayed')
  onDelayed(): void {
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'delayed' });
  }

  private observeDuration(jobId: string, status: 'completed' | 'failed'): void {
    const startedAt = this.activeAt.get(jobId);
    if (startedAt === undefined) {
      // No active entry on this replica — job was activated by a different
      // API replica. Skip rather than emit a NaN sample.
      return;
    }
    this.activeAt.delete(jobId);
    const durationSeconds = (Date.now() - startedAt) / 1000;
    this.metrics.bullmqJobDurationSeconds.observe(
      { queue: this.queueLabel, status },
      durationSeconds,
    );
  }
}

@QueueEventsListener(QUEUE_NAMES.EMAIL_NOTIFICATION)
@Injectable()
export class EmailNotificationMetricsListener extends QueueMetricsListenerBase {
  constructor(metrics: MetricsService) {
    super(metrics, QUEUE_NAMES.EMAIL_NOTIFICATION);
  }
}

@QueueEventsListener(QUEUE_NAMES.UPLOAD_VERIFICATION)
@Injectable()
export class UploadVerificationMetricsListener extends QueueMetricsListenerBase {
  constructor(metrics: MetricsService) {
    super(metrics, QUEUE_NAMES.UPLOAD_VERIFICATION);
  }
}
