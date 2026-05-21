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
  onStalled(): void {
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'stalled' });
  }

  @OnQueueEvent('delayed')
  onDelayed(): void {
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'delayed' });
  }

  private observeDuration(jobId: string, status: 'completed' | 'failed'): void {
    const startedAt = this.activeAt.get(jobId);
    // No active entry means the job was activated on a different replica; skip rather than emit NaN.
    if (startedAt === undefined) return;
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
