import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { MetricsService } from './metrics.service';

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
        // Non-fatal — gauge is stale until next tick.
        this.logger.warn(`Queue depth collector failed for "${q.name}": ${String(err)}`);
      }
    }
  }
}
