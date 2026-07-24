import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { dlqNameFor, routeFailedJobToDlq } from '@nestjs-fastify-nx/infra-redis';
import { QUEUE_NAMES, positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

interface DlqMonitorEnv {
  REDIS_QUEUE_HOST: string;
  REDIS_QUEUE_PORT: number;
  REDIS_QUEUE_PREFIX: string;
}

// Cap the per-queue scan so one enormous failed set can't stall a reconcile tick.
const RECONCILE_SCAN_LIMIT = 1000;

// Emits structured warn logs for alerting (Loki/Datadog). DLQ breach signals SMTP/S3/template failure.
@Injectable()
export class DlqMonitorTask implements OnApplicationShutdown {
  private readonly logger = new Logger(DlqMonitorTask.name);
  private readonly threshold = positiveIntEnv('DLQ_ALERT_THRESHOLD', 10);
  // Each source queue paired with its DLQ. Source queues are needed by reconcile(); the DLQs by check().
  private readonly pairs: { source: Queue; dlq: Queue }[];
  // Skip a tick if the previous one is still running (slow Redis) — @nestjs/schedule won't serialize.
  private running = false;
  private reconcileRunning = false;

  constructor(
    config: ConfigService<DlqMonitorEnv, true>,
    private readonly leadership: SchedulerLeaderService,
  ) {
    const connection = {
      host: config.get('REDIS_QUEUE_HOST', { infer: true }),
      port: config.get('REDIS_QUEUE_PORT', { infer: true }),
    };
    const prefix = config.get('REDIS_QUEUE_PREFIX', { infer: true });

    // Own connections directly (not via BullModule) to avoid registering a worker at boot.
    this.pairs = Object.values(QUEUE_NAMES).map((name) => ({
      source: new Queue(name, { connection, prefix }),
      dlq: new Queue(dlqNameFor(name), { connection, prefix }),
    }));
  }

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'UTC' })
  async check(): Promise<void> {
    if (!this.leadership.isLeader() || this.running) return;
    this.running = true;
    try {
      for (const { dlq } of this.pairs) {
        try {
          const counts = await dlq.getJobCounts('waiting', 'failed');
          const total = (counts['waiting'] ?? 0) + (counts['failed'] ?? 0);
          if (total >= this.threshold) {
            this.logger.warn(
              `DLQ "${dlq.name}" has ${total} job(s) (>= threshold ${this.threshold}); manual triage required`,
            );
          }
        } catch (err) {
          this.logger.error(`Failed to count DLQ "${dlq.name}": ${String(err)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // Safety net for the real-time DeadLetterRouter (a worker @QueueEventsListener): its QueueEvents
  // stream reads from '$' with no checkpoint, so a `failed` event emitted while the worker is
  // restarting/deploying is missed and never dead-lettered. This periodically sweeps each source
  // queue's terminal-failed jobs and routes any that never reached the DLQ. routeFailedJobToDlq is
  // idempotent (jobId `dlq__<id>`); the pre-check just avoids redundant work and log noise.
  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: 'UTC' })
  async reconcile(): Promise<void> {
    if (!this.leadership.isLeader() || this.reconcileRunning) return;
    this.reconcileRunning = true;
    try {
      for (const { source, dlq } of this.pairs) {
        let failed: Awaited<ReturnType<Queue['getFailed']>>;
        try {
          failed = await source.getFailed(0, RECONCILE_SCAN_LIMIT - 1);
        } catch (err) {
          this.logger.error(`DLQ reconcile scan failed for "${source.name}": ${String(err)}`);
          continue;
        }
        // No silent cap: if the failed set fills the scan window, older/newer entries beyond it are
        // not reconciled this tick. Surfaces the invariant (keep removeOnFail.count <= this limit).
        if (failed.length >= RECONCILE_SCAN_LIMIT) {
          this.logger.warn(
            `DLQ reconcile hit the ${RECONCILE_SCAN_LIMIT}-job scan window for "${source.name}"; a larger failed backlog may not be fully reconciled`,
          );
        }
        for (const job of failed) {
          if (job.id === undefined) continue;
          const jobId = String(job.id);
          const alreadyRouted = await dlq.getJob(`dlq__${jobId}`).catch(() => undefined);
          if (alreadyRouted) continue;
          await routeFailedJobToDlq(
            source,
            dlq,
            { jobId, failedReason: job.failedReason ?? 'reconciled: missed failed event' },
            this.logger,
          );
        }
      }
    } finally {
      this.reconcileRunning = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const queues = this.pairs.flatMap(({ source, dlq }) => [source, dlq]);
    await Promise.all(
      queues.map(async (queue) => {
        try {
          await queue.close();
        } catch {
          await queue.disconnect().catch(() => undefined);
        }
      }),
    );
  }
}
