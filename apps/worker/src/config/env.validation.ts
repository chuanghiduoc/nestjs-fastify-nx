import { z } from 'zod';
import {
  databaseEnvShape,
  mailEnvShape,
  nodeEnvShape,
  otelEnvShape,
  outboxPurgeEnvShape,
  parseEnvOrThrow,
  redisQueueEnvShape,
  refineDatabasePoolBounds,
  refineDatabaseUrlProd,
  refineMailProd,
  refineRedisQueuePasswordProd,
  refineStorageProd,
  sentryEnvShape,
  storageEnvShape,
} from '@nestjs-fastify-nx/shared';

const workerEnvSchema = z
  .object({
    // Database persists durable upload verification state.
    ...databaseEnvShape('nestjs-fastify-worker'),

    // Redis queue
    ...redisQueueEnvShape(),

    // Storage (S3 / MinIO) — needed by the upload-verification processor.
    ...storageEnvShape(),
    MALWARE_SCANNER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    MALWARE_SCANNER_HOST: z.string().default('localhost'),
    MALWARE_SCANNER_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
    MALWARE_SCANNER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    // ClamAV clamps MaxFileSize to 2 GiB internally and skips anything larger, so sending more is
    // pure waste. Capped at that ceiling rather than left open: a higher value would stream an
    // oversized object to clamd and reopen the mid-stream refusal this gate exists to avoid. Lower
    // it to match a scanner configured more tightly.
    MALWARE_SCANNER_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(2 * 1024 * 1024 * 1024)
      .default(2 * 1024 * 1024 * 1024),

    // Mail (Nodemailer SMTP)
    ...mailEnvShape(),

    // Per-queue worker concurrency. The `@Processor` decorator seeds it at module load — i.e. before
    // ConfigModule parses .env — so each processor re-applies the validated value onto its BullMQ
    // Worker at bootstrap (see ApplyWorkerConcurrency). Increase before scaling WORKER_REPLICAS:
    // concurrency × replicas is the effective parallelism.
    WORKER_EMAIL_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(5),
    WORKER_UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(5),

    // BullMQ rate limiter for the email queue — deliveries per duration window, independent of
    // WORKER_EMAIL_CONCURRENCY. Tune to the SMTP provider's own rate limit. Unlike concurrency this
    // is fixed at Worker construction (BullMQ exposes no setter), so it is load-time only: it must
    // come from the real process environment, not from a .env file read after boot.
    WORKER_EMAIL_LIMITER_MAX: z.coerce.number().int().min(1).max(100_000).default(100),
    WORKER_EMAIL_LIMITER_DURATION_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(60_000),

    // App
    ...nodeEnvShape(),

    // OpenTelemetry (read by tracing.ts via process.env directly; included here for
    // completeness and so misconfiguration surfaces at boot rather than at first span)
    ...otelEnvShape('nestjs-fastify-worker'),

    // Outbox event retention (validated here for .env.example parity; only the
    // scheduler's purge cron is the runtime consumer).
    ...outboxPurgeEnvShape(),

    // Sentry. Default 0.1 here vs 0.01 in the api validator on purpose: a transaction is one BullMQ
    // job, and job throughput is orders of magnitude below API request rate — 1% would leave the
    // worker with too few traces to diagnose anything.
    ...sentryEnvShape(0.1),
  })
  .superRefine((data, ctx) => {
    refineDatabasePoolBounds(data, ctx);
    if (data.NODE_ENV !== 'production') return;

    refineRedisQueuePasswordProd(data, ctx);
    refineStorageProd(data, ctx);
    refineDatabaseUrlProd(data, ctx);
    // The worker is the process that actually sends mail, so it must fail loudly at boot on a default
    // SMTP host rather than let every email job fail at runtime (mirrors the api validator).
    refineMailProd(data, ctx);
  });

export type WorkerEnvConfig = z.infer<typeof workerEnvSchema>;

export function validateWorkerConfig(config: Record<string, unknown>): WorkerEnvConfig {
  return parseEnvOrThrow(workerEnvSchema, config, 'Worker environment');
}
