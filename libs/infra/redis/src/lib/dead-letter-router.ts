import { Logger, Type } from '@nestjs/common';
import { OnQueueEvent, QueueEventsHost, QueueEventsListener } from '@nestjs/bullmq';
import type { Queue, JobsOptions } from 'bullmq';

interface FailedEvent {
  jobId: string;
  failedReason: string;
  prev?: string;
}

export interface DeadLetterEnvelope {
  originalQueue: string;
  originalJobId: string;
  originalJobName: string;
  payload: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

// DLQ never auto-purges — operators must triage manually. No backoff; DLQ jobs are inert payloads.
const DLQ_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: false,
  removeOnFail: false,
};

// Transient retries are ignored — DLQ only receives jobs that exhausted their retry budget.
// Idempotency via jobId: dlq__<originalJobId>; BullMQ deduplicates concurrent adds from multiple replicas.
export async function routeFailedJobToDlq(
  source: Queue,
  dlq: Queue,
  args: FailedEvent,
  logger: Logger,
): Promise<void> {
  try {
    const job = await source.getJob(args.jobId);
    if (!job) {
      // The job was already evicted by removeOnFail (count/age) before this failed-event was
      // processed. Distinguish it from a successfully routed job so a silently missing DLQ entry
      // is traceable rather than an unexplained gap.
      logger.warn(
        `Failed job ${args.jobId} on queue "${source.name}" was reaped before dead-lettering — not routed to DLQ`,
      );
      return;
    }

    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    const envelope: DeadLetterEnvelope = {
      originalQueue: source.name,
      originalJobId: String(job.id ?? args.jobId),
      originalJobName: job.name,
      payload: job.data,
      failedReason: args.failedReason,
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };

    await dlq.add(job.name, envelope, {
      ...DLQ_JOB_OPTIONS,
      jobId: `dlq__${envelope.originalJobId}`, // BullMQ rejects ':' in jobIds — '__' separator.
    });

    logger.warn(
      `Dead-lettered job "${job.name}" (id=${envelope.originalJobId}, attempts=${envelope.attemptsMade}) — ${args.failedReason}`,
    );
  } catch (err) {
    logger.error(
      `Failed to route job ${args.jobId} to DLQ — ${String(err)}`,
      err instanceof Error ? err.stack : undefined,
    );
  }
}

// Generates a @QueueEventsListener class per queue so multiple routers coexist in the same DI graph.
export function createDeadLetterRouterClass(sourceName: string): Type<QueueEventsHost> {
  @QueueEventsListener(sourceName)
  class DeadLetterRouter extends QueueEventsHost {
    private readonly logger = new Logger(`DeadLetterRouter:${sourceName}`);

    constructor(
      private readonly source: Queue,
      private readonly dlq: Queue,
    ) {
      super();
    }

    @OnQueueEvent('failed')
    async onFailed(args: FailedEvent): Promise<void> {
      await routeFailedJobToDlq(this.source, this.dlq, args, this.logger);
    }
  }

  Object.defineProperty(DeadLetterRouter, 'name', {
    value: `DeadLetterRouter_${sourceName.replace(/[^A-Za-z0-9_]/g, '_')}`,
  });
  return DeadLetterRouter;
}
