import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { MetricsService } from './metrics.service';
import { MetricsLeaderService } from './metrics-leader.service';

@Injectable()
export class QueueDepthCollector implements OnModuleInit {
  private readonly logger = new Logger(QueueDepthCollector.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL_NOTIFICATION) private readonly emailQ: Queue,
    @InjectQueue(QUEUE_NAMES.UPLOAD_VERIFICATION) private readonly uploadQ: Queue,
    private readonly metrics: MetricsService,
    private readonly leader: MetricsLeaderService,
  ) {}

  onModuleInit(): void {
    // Drop every series on losing the lease. A gauge left at its last written value keeps being
    // scraped from this replica while the new leader publishes the real one, so a dashboard summing
    // across replicas would double-count queue depth after every failover.
    this.leader.onLeadershipLost(() => this.metrics.bullmqQueueDepth.reset());
  }

  @Interval(30_000)
  async collect(): Promise<void> {
    // Queue depth is one global truth read from Redis — only the leader records it, else every
    // replica sets the same gauge and dashboards read N× the real depth.
    if (!this.leader.isLeader()) return;

    for (const q of [this.emailQ, this.uploadQ]) {
      try {
        const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        for (const [state, n] of Object.entries(counts)) {
          this.metrics.bullmqQueueDepth.labels(q.name, state).set(n);
        }
      } catch (err) {
        // Non-fatal — gauge is stale until next tick.
        this.logger.warn({ err, queue: q.name }, 'Queue depth collector failed');
      }
    }
  }
}
