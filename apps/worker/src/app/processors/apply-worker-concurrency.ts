import type { Logger } from '@nestjs/common';
import type { WorkerHost } from '@nestjs/bullmq';

/**
 * Re-applies a validated concurrency value onto a BullMQ Worker after boot.
 *
 * `@Processor(name, { concurrency })` evaluates its options while the module's import graph loads,
 * which happens BEFORE `ConfigModule.forRoot()` parses `.env` into `process.env`. The decorator's
 * value is therefore whatever the raw process environment held at import time — the default,
 * whenever the setting lives in a `.env` file rather than in real env vars. BullMQ exposes a
 * `concurrency` setter that resizes the running worker, so reconciling here makes ConfigService the
 * single source of truth regardless of how the process was started.
 *
 * Call from `onApplicationBootstrap`, not `onModuleInit`: @nestjs/bullmq's explorer assigns
 * `host.worker` during its own `onModuleInit`, and hook ordering between providers is not defined.
 */
export function applyWorkerConcurrency(
  host: WorkerHost,
  concurrency: number,
  logger: Logger,
): void {
  const worker = host.worker;
  if (!worker) {
    logger.warn('BullMQ worker not attached at bootstrap; concurrency left at its decorator value');
    return;
  }
  if (worker.concurrency === concurrency) return;

  logger.log(`Applying validated concurrency ${concurrency} (was ${worker.concurrency})`);
  worker.concurrency = concurrency;
}
