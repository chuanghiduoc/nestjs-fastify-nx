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

/**
 * DLQ never auto-purges by default — operators must triage manually before
 * dropping. Backoff doesn't apply because DLQ jobs are inert payloads.
 */
const DLQ_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: false,
  removeOnFail: false,
};

/**
 * Inspects a BullMQ `failed` queue event and, when the job has exhausted its
 * retry budget, routes a diagnostic envelope into a sibling DLQ queue.
 * Transient retry failures are intentionally ignored so the DLQ only
 * contains true dead-letters that operators must act on.
 *
 * Concurrency: all subscribers receive the same `failed` event via Redis
 * pub/sub. Idempotency comes from `jobId: dlq__<originalJobId>` — even if two
 * processes both observe the failure, BullMQ deduplicates on jobId so only
 * the first add() persists.
 */
export async function routeFailedJobToDlq(
  source: Queue,
  dlq: Queue,
  args: FailedEvent,
  logger: Logger,
): Promise<void> {
  try {
    const job = await source.getJob(args.jobId);
    if (!job) return;

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
      // BullMQ rejects ':' in custom jobIds — use '__' separator.
      jobId: `dlq__${envelope.originalJobId}`,
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

/**
 * Builds a `@QueueEventsListener(sourceName)` Nest provider class bound to a
 * specific queue. The decorator must be applied at class-construction time;
 * we generate a fresh class per managed queue so multiple routers can
 * coexist in the same DI graph.
 *
 * The returned class receives the source `Queue` and the DLQ `Queue` via
 * constructor injection. Wiring is done by `DeadLetterModule.forFeature`.
 */
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
