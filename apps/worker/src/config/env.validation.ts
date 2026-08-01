import { z } from 'zod';
import { stripEmptyEnvStrings } from '@nestjs-fastify-nx/shared';

const workerEnvSchema = z
  .object({
    // Database persists durable upload verification state.
    DATABASE_URL: z.string().trim().min(1),
    DATABASE_DIRECT_URL: z.string().trim().min(1).optional(),
    DATABASE_REPLICA_URL: z.string().trim().min(1).optional(),
    DATABASE_REPLICA_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(10),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(1000).default(0),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    DATABASE_APPLICATION_NAME: z.string().default('nestjs-fastify-worker'),
    DB_PASSWORD_FILE: z.string().trim().min(1).optional(),
    DATABASE_SLOW_QUERY_MS: z.coerce.number().int().min(1).default(200),
    // Dev-only full query logging (incl. params) at debug level. PrismaService ignores it in production.
    DATABASE_LOG_QUERIES: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    // Redis queue
    REDIS_QUEUE_HOST: z.string().default('localhost'),
    REDIS_QUEUE_PORT: z.coerce.number().int().min(1).max(65535).default(6380),
    REDIS_QUEUE_PREFIX: z.string().default('bull'),

    // Storage (S3 / MinIO) — needed by the upload-verification processor.
    STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
    // S3StorageAdapter runs in this process too, so the key it reads must be validated here as
    // well — otherwise it silently falls through to a raw, unvalidated process.env lookup.
    STORAGE_PUBLIC_ENDPOINT: z.string().optional(),
    STORAGE_BUCKET: z.string().default('uploads'),
    STORAGE_REGION: z.string().default('us-east-1'),
    // Self-hosted backends serve path-style; real AWS S3 documents virtual-hosted-style.
    STORAGE_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
    // WHEN_REQUIRED stops the SDK attaching x-amz-checksum-crc32, which some S3-compatible
    // backends reject outright.
    STORAGE_CHECKSUM_MODE: z.enum(['WHEN_SUPPORTED', 'WHEN_REQUIRED']).default('WHEN_SUPPORTED'),
    STORAGE_ACCESS_KEY: z.string().default('minioadmin'),
    STORAGE_SECRET_KEY: z.string().default('minioadmin'),
    STORAGE_DOWNLOAD_URL_EXPIRES_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(3_600),
    MALWARE_SCANNER_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    MALWARE_SCANNER_HOST: z.string().default('localhost'),
    MALWARE_SCANNER_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
    MALWARE_SCANNER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    // ClamAV clamps MaxFileSize to 2 GiB internally and skips anything larger, so sending more is
    // pure waste. Lower it to match a scanner configured more tightly.
    MALWARE_SCANNER_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .default(2 * 1024 * 1024 * 1024),

    // Mail (Nodemailer SMTP)
    MAIL_HOST: z.string().default('localhost'),
    MAIL_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    MAIL_USER: z.string().default(''),
    MAIL_PASSWORD: z.string().default(''),
    MAIL_IGNORE_TLS: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    MAIL_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    MAIL_REQUIRE_TLS: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    MAIL_DEFAULT_EMAIL: z.email().default('noreply@example.com'),
    MAIL_DEFAULT_NAME: z.string().default('No Reply'),

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
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),

    // OpenTelemetry (read by tracing.ts via process.env directly; included here for
    // completeness and so misconfiguration surfaces at boot rather than at first span)
    OTEL_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    OTEL_SERVICE_NAME: z.string().default('nestjs-fastify-worker'),
    OTEL_SERVICE_NAMESPACE: z.string().default('app'),
    OTEL_SERVICE_VERSION: z.string().default('0.0.0'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().default(''),
    OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),
    // See api validator. Worker has no public HTTP surface, but the flag stays for .env.example parity.
    OTEL_TRUST_INBOUND_TRACEPARENT: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    // The worker has no prom-client /metrics endpoint, so OTLP push is how its runtime metrics leave
    // the process — enable this (OTEL_METRICS_EXPORT_ENABLED=true) when OTEL_ENABLED is on in prod.
    OTEL_METRICS_EXPORT_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    OTEL_DEBUG: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    // Outbox event retention (validated here for .env.example parity; only the
    // scheduler's purge cron is the runtime consumer).
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    OUTBOX_PURGE_BATCH_SIZE: z.coerce.number().int().min(100).max(10000).default(1000),
    OUTBOX_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10000).default(200),

    // Sentry. Default 0.1 here vs 0.01 in the api validator on purpose: a transaction is one BullMQ
    // job, and job throughput is orders of magnitude below API request rate — 1% would leave the
    // worker with too few traces to diagnose anything.
    SENTRY_DSN: z.string().optional().default(''),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    SENTRY_ENVIRONMENT: z.string().default('development'),
  })
  .superRefine((data, ctx) => {
    if (data.DATABASE_POOL_MIN > data.DATABASE_POOL_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_POOL_MIN'],
        message: 'DATABASE_POOL_MIN must be less than or equal to DATABASE_POOL_MAX',
      });
    }
    if (data.NODE_ENV !== 'production') return;

    if (data.STORAGE_ACCESS_KEY === 'minioadmin') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_ACCESS_KEY'],
        message: 'Must not use default value in production',
      });
    }
    if (data.STORAGE_SECRET_KEY === 'minioadmin') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_SECRET_KEY'],
        message: 'Must not use default value in production',
      });
    }
    if (!data.MALWARE_SCANNER_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['MALWARE_SCANNER_ENABLED'],
        message: 'Malware scanning must be enabled in production',
      });
    }
    // The worker is the process that actually sends mail, so it must fail loudly at boot on a default
    // SMTP host rather than let every email job fail at runtime (mirrors the api validator).
    if (data.MAIL_HOST === 'localhost') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_HOST'],
        message: 'MAIL_HOST must point to a real SMTP server in production',
      });
    }
    if (data.MAIL_DEFAULT_EMAIL === 'noreply@example.com') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_DEFAULT_EMAIL'],
        message: 'MAIL_DEFAULT_EMAIL must be set to a real address in production',
      });
    }

    // Only enforce transport TLS when SMTP authentication sends credentials.
    if (data.MAIL_USER) {
      if (data.MAIL_IGNORE_TLS) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_IGNORE_TLS'],
          message:
            'MAIL_IGNORE_TLS must be false in production when MAIL_USER is set — plaintext SMTP exposes credentials',
        });
      }
      if (!data.MAIL_SECURE && !data.MAIL_REQUIRE_TLS) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_REQUIRE_TLS'],
          message:
            'Enable MAIL_SECURE or MAIL_REQUIRE_TLS in production when MAIL_USER is set so SMTP credentials negotiate TLS',
        });
      }
    }
  });

export type WorkerEnvConfig = z.infer<typeof workerEnvSchema>;

export function validateWorkerConfig(config: Record<string, unknown>): WorkerEnvConfig {
  const result = workerEnvSchema.safeParse(stripEmptyEnvStrings(config));

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Worker environment validation failed. Fix the following variables:\n${formatted}`,
    );
  }

  return result.data;
}
