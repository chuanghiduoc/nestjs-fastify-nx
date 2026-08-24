import { z } from 'zod';
import { stripEmptyEnvStrings } from '@nestjs-fastify-nx/shared';

const schedulerEnvSchema = z
  .object({
    DATABASE_URL: z.string().trim().min(1),
    DATABASE_DIRECT_URL: z.string().trim().min(1).optional(),
    DATABASE_REPLICA_URL: z.string().trim().min(1).optional(),
    DATABASE_REPLICA_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(10),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(1000).default(0),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    DATABASE_APPLICATION_NAME: z.string().default('nestjs-fastify-scheduler'),
    DB_PASSWORD_FILE: z.string().trim().min(1).optional(),
    // Prisma query events above this duration are logged as `warn`. See PrismaService.
    DATABASE_SLOW_QUERY_MS: z.coerce.number().int().min(1).default(200),
    // Dev-only full query logging (incl. params) at debug level. PrismaService ignores it in production.
    DATABASE_LOG_QUERIES: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    REDIS_QUEUE_HOST: z.string().default('localhost'),
    REDIS_QUEUE_PORT: z.coerce.number().int().min(1).max(65535).default(6380),
    REDIS_QUEUE_PREFIX: z.string().default('bull'),

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

    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),

    OTEL_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    OTEL_SERVICE_NAME: z.string().default('nestjs-fastify-scheduler'),
    OTEL_SERVICE_NAMESPACE: z.string().default('app'),
    OTEL_SERVICE_VERSION: z.string().default('0.0.0'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().default(''),
    OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),
    OTEL_TRUST_INBOUND_TRACEPARENT: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    OTEL_METRICS_EXPORT_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    OTEL_DEBUG: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    AUDIT_LOG_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
    DLQ_ALERT_THRESHOLD: z.coerce.number().int().min(1).max(100_000).default(10),
    INACTIVE_USER_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(90),
    USER_PURGE_BATCH_SIZE: z.coerce.number().int().min(10).max(10_000).default(500),
    USER_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),
    STORED_FILE_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(10).max(10_000).default(500),
    STORED_FILE_FINALIZING_STALE_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
    STORED_FILE_VERIFYING_STALE_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    STORED_FILE_ORPHAN_GRACE_MINUTES: z.coerce.number().int().min(5).max(1_440).default(60),
    STORED_FILE_PURGE_AFTER_DAYS: z.coerce.number().int().min(1).max(3_650).default(30),

    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
    OUTBOX_TX_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    // Exponential retry backoff between outbox delivery attempts. Without it the relay re-claims a
    // failing row every poll interval, so a 10-second downstream outage burns all OUTBOX_MAX_ATTEMPTS
    // and permanently parks every pending event. The delay uses the pre-increment attempt count, so
    // at base=2s/cap=5m the 1st and 10th attempts are ~13.5 minutes apart instead of ~10 seconds.
    OUTBOX_RETRY_BASE_MS: z.coerce.number().int().min(100).max(600_000).default(2_000),
    OUTBOX_RETRY_MAX_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),

    OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    OUTBOX_PURGE_BATCH_SIZE: z.coerce.number().int().min(100).max(10_000).default(1_000),
    OUTBOX_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),

    VERIFICATION_PURGE_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(1),
    VERIFICATION_PURGE_BATCH_SIZE: z.coerce.number().int().min(100).max(10_000).default(1_000),
    VERIFICATION_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),

    SESSION_PURGE_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(1),
    SESSION_PURGE_BATCH_SIZE: z.coerce.number().int().min(100).max(10_000).default(1_000),
    SESSION_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),

    EVENT_PUBLISHER_DRIVER: z.enum(['inprocess', 'outbox']).default('inprocess'),

    SENTRY_DSN: z.string().optional().default(''),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.01),
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
    if (data.OUTBOX_RETRY_BASE_MS > data.OUTBOX_RETRY_MAX_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['OUTBOX_RETRY_BASE_MS'],
        message: 'OUTBOX_RETRY_BASE_MS must be less than or equal to OUTBOX_RETRY_MAX_MS',
      });
    }
    if (data.NODE_ENV === 'production' && data.STORAGE_ACCESS_KEY === 'minioadmin') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_ACCESS_KEY'],
        message: 'Must not use default value in production',
      });
    }
    if (data.NODE_ENV === 'production' && data.STORAGE_SECRET_KEY === 'minioadmin') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_SECRET_KEY'],
        message: 'Must not use default value in production',
      });
    }
    // The scheduler drains the outbox; in production it must run in outbox mode so relayed events are
    // durable. In-process publishing would silently drop events on crash/rollback.
    if (data.NODE_ENV === 'production' && data.EVENT_PUBLISHER_DRIVER !== 'outbox') {
      ctx.addIssue({
        code: 'custom',
        path: ['EVENT_PUBLISHER_DRIVER'],
        message:
          'EVENT_PUBLISHER_DRIVER must be "outbox" in production for durable, crash-safe event delivery',
      });
    }
  });

export type SchedulerEnvConfig = z.infer<typeof schedulerEnvSchema>;

export function validateSchedulerConfig(config: Record<string, unknown>): SchedulerEnvConfig {
  const result = schedulerEnvSchema.safeParse(stripEmptyEnvStrings(config));

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Scheduler environment validation failed. Fix the following variables:\n${formatted}`,
    );
  }

  return result.data;
}
