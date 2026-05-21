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

interface StalledEvent {
  jobId: string;
}

// Stale entries (terminal event landed on a different replica, Redis reconnect)
// linger forever without a cap. 1h covers the longest legitimate job.
const MAX_ACTIVE_AGE_MS = 60 * 60 * 1000;

// @QueueEventsListener requires a literal name — one subclass per queue.
// At API_REPLICAS > 1 every replica receives each event; divide counters in dashboards.
abstract class QueueMetricsListenerBase extends QueueEventsHost {
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
  onStalled(args: StalledEvent): void {
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'stalled' });
    // Stalled jobs get re-claimed elsewhere — drop the local active entry so it can't leak.
    this.activeAt.delete(args.jobId);
    this.sweepStale();
  }

  @OnQueueEvent('delayed')
  onDelayed(): void {
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'delayed' });
  }

  private observeDuration(jobId: string, status: 'completed' | 'failed'): void {
    const startedAt = this.activeAt.get(jobId);
    if (startedAt === undefined) return;
    this.activeAt.delete(jobId);
    const durationSeconds = (Date.now() - startedAt) / 1000;
    // Drop the sample if the active timestamp is impossibly old — keeps the histogram clean.
    if (durationSeconds * 1000 > MAX_ACTIVE_AGE_MS) return;
    this.metrics.bullmqJobDurationSeconds.observe(
      { queue: this.queueLabel, status },
      durationSeconds,
    );
  }

  private sweepStale(): void {
    const cutoff = Date.now() - MAX_ACTIVE_AGE_MS;
    for (const [id, ts] of this.activeAt) {
      if (ts < cutoff) this.activeAt.delete(id);
    }
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
