import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { MetricsService } from './metrics.service';

/**
 * Polls each BullMQ queue for job counts every 30 seconds and records them as
 * Prometheus gauge samples. Allows operators to detect backpressure (rising
 * `waiting` count) without needing a dedicated Redis exporter.
 *
 * 30s interval is intentional — 2 Redis calls × 30s ≈ negligible QPS even at
 * 10 API replicas. If replica count ever exceeds ~50, switch to leader-election
 * (Redis SETNX) to avoid multiplied scrapes.
 */
@Injectable()
export class QueueDepthCollector {
  private readonly logger = new Logger(QueueDepthCollector.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL_NOTIFICATION) private readonly emailQ: Queue,
    @InjectQueue(QUEUE_NAMES.UPLOAD_VERIFICATION) private readonly uploadQ: Queue,
    private readonly metrics: MetricsService,
  ) {}

  @Interval(30_000)
  async collect(): Promise<void> {
    for (const q of [this.emailQ, this.uploadQ]) {
      try {
        const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        for (const [state, n] of Object.entries(counts)) {
          this.metrics.bullmqQueueDepth.labels(q.name, state).set(n);
        }
      } catch (err) {
        // Non-fatal — gauge is stale until next tick. Prevents Redis hiccup from
        // surfacing as an unhandled rejection that kills the API process.
        this.logger.warn(`Queue depth collector failed for "${q.name}": ${String(err)}`);
      }
    }
  }
}
