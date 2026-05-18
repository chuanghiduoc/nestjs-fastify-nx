import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { dlqNameFor } from '@nestjs-fastify-nx/infra-redis';
import { QUEUE_NAMES, positiveIntEnv } from '@nestjs-fastify-nx/shared';

interface DlqMonitorEnv {
  REDIS_QUEUE_HOST: string;
  REDIS_QUEUE_PORT: number;
  REDIS_QUEUE_PREFIX: string;
}

/**
 * Polls the per-queue DLQs every minute and emits a structured warn log when
 * any DLQ exceeds the configured threshold. Operators are expected to scrape
 * the log stream into their alerting system (Loki / Datadog / Sentry breadcrumb
 * → Slack notification) rather than have the scheduler hold credentials for a
 * third-party paging service.
 *
 * DLQ jobs are kept around forever by `DLQ_JOB_OPTIONS` so any breach indicates
 * a real failure mode that needs triage — usually a misconfigured downstream
 * (SMTP credentials rotated, S3 bucket missing, mail template invalid). The
 * Bull Board UI is the manual replay surface.
 */
@Injectable()
export class DlqMonitorTask {
  private readonly logger = new Logger(DlqMonitorTask.name);
  private readonly threshold = positiveIntEnv('DLQ_ALERT_THRESHOLD', 10);
  private readonly queues: Queue[];

  constructor(config: ConfigService<DlqMonitorEnv, true>) {
    const connection = {
      host: config.get('REDIS_QUEUE_HOST', { infer: true }),
      port: config.get('REDIS_QUEUE_PORT', { infer: true }),
    };
    const prefix = config.get('REDIS_QUEUE_PREFIX', { infer: true });

    // DLQ queues live in the same Redis instance as their source queues. We
    // own these connections directly (instead of injecting BullModule) so
    // the scheduler stays free of source-queue producers — adding the source
    // queue here would force every scheduler boot to register a worker for it.
    this.queues = Object.values(QUEUE_NAMES).map(
      (name) =>
        new Queue(dlqNameFor(name), {
          connection,
          prefix,
        }),
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async check(): Promise<void> {
    for (const queue of this.queues) {
      try {
        // `waiting + failed` covers both newly-enqueued envelopes and ones the
        // operator left in failed state after a manual retry — both signal a
        // backlog. Active/completed/delayed are not interesting on a DLQ.
        const counts = await queue.getJobCounts('waiting', 'failed');
        const total = (counts.waiting ?? 0) + (counts.failed ?? 0);
        if (total >= this.threshold) {
          this.logger.warn(
            `DLQ "${queue.name}" has ${total} job(s) (>= threshold ${this.threshold}); manual triage required`,
          );
        }
      } catch (err) {
        this.logger.error(`Failed to count DLQ "${queue.name}": ${String(err)}`);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.queues.map((q) => q.close().catch(() => undefined)));
  }
}
