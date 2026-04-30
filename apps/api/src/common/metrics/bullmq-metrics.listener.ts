import { OnQueueEvent, QueueEventsHost, QueueEventsListener } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { MetricsService } from './metrics.service';

const QUEUE_NAME = 'email-notification';

interface CompletedEvent {
  jobId: string;
  prev?: string;
}

interface FailedEvent {
  jobId: string;
  failedReason: string;
  prev?: string;
}

interface ActiveEvent {
  jobId: string;
  prev?: string;
}

interface DelayedEvent {
  jobId: string;
}

interface StalledEvent {
  jobId: string;
}

/**
 * Listens to BullMQ QueueEvents from the API process so that metrics are
 * captured even when the worker container scales independently. BullMQ
 * dispatches these events through Redis pub/sub, so any client connected to
 * the queue can observe them.
 *
 * We track active timestamps in-memory to compute job duration when an event
 * lacks the `processedOn`/`finishedOn` fields directly.
 */
@QueueEventsListener(QUEUE_NAME)
@Injectable()
export class BullMqMetricsListener extends QueueEventsHost {
  private readonly activeTimestamps = new Map<string, number>();

  constructor(private readonly metrics: MetricsService) {
    super();
  }

  @OnQueueEvent('active')
  onActive(args: ActiveEvent): void {
    this.activeTimestamps.set(args.jobId, Date.now());
  }

  @OnQueueEvent('completed')
  onCompleted(args: CompletedEvent): void {
    this.metrics.bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'completed' });
    this.observeDuration(args.jobId, 'completed');
  }

  @OnQueueEvent('failed')
  onFailed(args: FailedEvent): void {
    this.metrics.bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'failed' });
    this.observeDuration(args.jobId, 'failed');
  }

  @OnQueueEvent('stalled')
  onStalled(args: StalledEvent): void {
    this.metrics.bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'stalled' });
    this.activeTimestamps.delete(args.jobId);
  }

  @OnQueueEvent('delayed')
  onDelayed(args: DelayedEvent): void {
    this.metrics.bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'delayed' });
    this.activeTimestamps.delete(args.jobId);
  }

  private observeDuration(jobId: string, status: 'completed' | 'failed'): void {
    const startedAt = this.activeTimestamps.get(jobId);
    if (typeof startedAt !== 'number') return;
    const seconds = (Date.now() - startedAt) / 1000;
    this.metrics.bullmqJobDurationSeconds.observe({ queue: QUEUE_NAME, status }, seconds);
    this.activeTimestamps.delete(jobId);
  }
}
