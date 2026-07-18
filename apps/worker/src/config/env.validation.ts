import { z } from 'zod';

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
    STORAGE_BUCKET: z.string().default('uploads'),
    STORAGE_REGION: z.string().default('us-east-1'),
    STORAGE_ACCESS_KEY: z.string().default('minioadmin'),
    STORAGE_SECRET_KEY: z.string().default('minioadmin'),
    STORAGE_DOWNLOAD_URL_EXPIRES_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(3_600),

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

    // Per-queue worker concurrency. Processor decorators read these at module load,
    // so Nx serve loads .env through Node runtimeArgs and containers inject them. Increase before
    // scaling WORKER_REPLICAS — concurrency × replicas is the effective parallelism.
    WORKER_EMAIL_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(5),
    WORKER_UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(5),

    // BullMQ rate limiter for the email queue — deliveries per duration window, independent of
    // WORKER_EMAIL_CONCURRENCY. Tune to the SMTP provider's own rate limit.
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

    // Sentry
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

// dotenv loads `KEY=` as `""`, which is NOT `undefined` — so `.optional()` on
// the schema would still run `.min(1)` on the empty string and fail. Strip
// empty strings so optional fields fall back to their defaults (or stay unset).
// Mirrors the api validator (apps/api/src/config/env.validation.ts).
function stripEmptyStrings(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return out;
}

export function validateWorkerConfig(config: Record<string, unknown>): WorkerEnvConfig {
  const result = workerEnvSchema.safeParse(stripEmptyStrings(config));

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
