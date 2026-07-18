import { OnQueueEvent, QueueEventsHost, QueueEventsListener } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { MetricsService } from './metrics.service';
import { MetricsLeaderService } from './metrics-leader.service';

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
const MAX_ACTIVE_AGE_NS = BigInt(MAX_ACTIVE_AGE_MS) * 1_000_000n;

// @QueueEventsListener requires a literal name — one subclass per queue.
// QueueEvents is a broadcast stream: at API_REPLICAS > 1 every replica receives every event, so
// unguarded inc() would multiply counters by the replica count. Recording is gated on the collector
// leader (single writer) so `sum()` over replicas equals the real job count.
abstract class QueueMetricsListenerBase extends QueueEventsHost {
  private readonly activeAt = new Map<string, bigint>();

  constructor(
    private readonly metrics: MetricsService,
    private readonly leader: MetricsLeaderService,
    private readonly queueLabel: string,
  ) {
    super();
  }

  // Map upkeep is not leader-gated: leadership can flip between `active` and the terminal event,
  // stranding the entry on the ex-leader. It is per-replica state; only the metric write is gated.
  @OnQueueEvent('active')
  onActive(args: ActiveEvent): void {
    this.activeAt.set(args.jobId, process.hrtime.bigint());
  }

  @OnQueueEvent('completed')
  onCompleted(args: CompletedEvent): void {
    this.recordTerminal(args.jobId, 'completed');
  }

  @OnQueueEvent('failed')
  onFailed(args: FailedEvent): void {
    this.recordTerminal(args.jobId, 'failed');
  }

  @OnQueueEvent('stalled')
  onStalled(args: StalledEvent): void {
    // Stalled jobs get re-claimed elsewhere — drop the local active entry so it can't leak.
    this.activeAt.delete(args.jobId);
    this.sweepStale();
    if (!this.leader.isLeader()) return;
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'stalled' });
  }

  @OnQueueEvent('delayed')
  onDelayed(): void {
    if (!this.leader.isLeader()) return;
    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status: 'delayed' });
  }

  private recordTerminal(jobId: string, status: 'completed' | 'failed'): void {
    const elapsedNs = this.takeElapsed(jobId);
    if (!this.leader.isLeader()) return;

    this.metrics.bullmqJobsTotal.inc({ queue: this.queueLabel, status });
    // Drop the sample if the active timestamp is missing (job started before this replica saw it)
    // or impossibly old — keeps the histogram clean.
    if (elapsedNs === undefined || elapsedNs > MAX_ACTIVE_AGE_NS) return;
    this.metrics.bullmqJobDurationSeconds.observe(
      { queue: this.queueLabel, status },
      Number(elapsedNs) / 1e9,
    );
  }

  private takeElapsed(jobId: string): bigint | undefined {
    const startedAt = this.activeAt.get(jobId);
    if (startedAt === undefined) return undefined;
    this.activeAt.delete(jobId);
    return process.hrtime.bigint() - startedAt;
  }

  private sweepStale(): void {
    const cutoff = process.hrtime.bigint() - MAX_ACTIVE_AGE_NS;
    for (const [id, ts] of this.activeAt) {
      if (ts < cutoff) this.activeAt.delete(id);
    }
  }
}

@QueueEventsListener(QUEUE_NAMES.EMAIL_NOTIFICATION)
@Injectable()
export class EmailNotificationMetricsListener extends QueueMetricsListenerBase {
  constructor(metrics: MetricsService, leader: MetricsLeaderService) {
    super(metrics, leader, QUEUE_NAMES.EMAIL_NOTIFICATION);
  }
}

@QueueEventsListener(QUEUE_NAMES.UPLOAD_VERIFICATION)
@Injectable()
export class UploadVerificationMetricsListener extends QueueMetricsListenerBase {
  constructor(metrics: MetricsService, leader: MetricsLeaderService) {
    super(metrics, leader, QUEUE_NAMES.UPLOAD_VERIFICATION);
  }
}
