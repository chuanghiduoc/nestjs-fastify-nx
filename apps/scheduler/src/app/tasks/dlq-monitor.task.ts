import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { dlqNameFor } from '@nestjs-fastify-nx/infra-redis';
import { QUEUE_NAMES, positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { SchedulerLeaderService } from '../leadership/scheduler-leader.service';

interface DlqMonitorEnv {
  REDIS_QUEUE_HOST: string;
  REDIS_QUEUE_PORT: number;
  REDIS_QUEUE_PREFIX: string;
}

// Emits structured warn logs for alerting (Loki/Datadog). DLQ breach signals SMTP/S3/template failure.
@Injectable()
export class DlqMonitorTask implements OnApplicationShutdown {
  private readonly logger = new Logger(DlqMonitorTask.name);
  private readonly threshold = positiveIntEnv('DLQ_ALERT_THRESHOLD', 10);
  private readonly queues: Queue[];

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
    this.queues = Object.values(QUEUE_NAMES).map(
      (name) =>
        new Queue(dlqNameFor(name), {
          connection,
          prefix,
        }),
    );
  }

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'UTC' })
  async check(): Promise<void> {
    if (!this.leadership.isLeader()) return;
    for (const queue of this.queues) {
      try {
        const counts = await queue.getJobCounts('waiting', 'failed');
        const total = (counts['waiting'] ?? 0) + (counts['failed'] ?? 0);
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
    await Promise.all(
      this.queues.map(async (queue) => {
        try {
          await queue.close();
        } catch {
          await queue.disconnect().catch(() => undefined);
        }
      }),
    );
  }
}
