import { z } from 'zod';
import { stripEmptyEnvStrings } from './env-readers';

export function envFlag(defaultValue: boolean) {
  return z
    .string()
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true');
}

export function databaseEnvShape(applicationName: string) {
  return {
    DATABASE_URL: z.string().trim().min(1),
    DATABASE_DIRECT_URL: z.string().trim().min(1).optional(),
    DATABASE_REPLICA_URL: z.string().trim().min(1).optional(),
    DATABASE_REPLICA_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(10),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(1000).default(0),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    DATABASE_APPLICATION_NAME: z.string().default(applicationName),
    DB_PASSWORD_FILE: z.string().trim().min(1).optional(),
    // Prisma query events above this duration are logged as `warn` (query template + duration
    // only — never params, which can carry PII/secrets). See PrismaService.
    DATABASE_SLOW_QUERY_MS: z.coerce.number().int().min(1).default(200),
    // Dev-only full query logging (incl. params) at debug level. PrismaService ignores it in production.
    DATABASE_LOG_QUERIES: envFlag(false),
  };
}

export function redisQueueEnvShape() {
  return {
    REDIS_QUEUE_HOST: z.string().default('localhost'),
    REDIS_QUEUE_PORT: z.coerce.number().int().min(1).max(65535).default(6380),
    REDIS_QUEUE_PREFIX: z.string().default('bull'),
    REDIS_QUEUE_PASSWORD: z.string().min(1).optional(),
  };
}

export function storageEnvShape() {
  return {
    STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
    // Browser-facing endpoint for presigned URLs; overrides STORAGE_ENDPOINT for
    // signing when the app reaches storage at an internal hostname (containers).
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
  };
}

export function otelEnvShape(serviceName: string) {
  return {
    OTEL_ENABLED: envFlag(false),
    OTEL_SERVICE_NAME: z.string().default(serviceName),
    OTEL_SERVICE_NAMESPACE: z.string().default('app'),
    OTEL_SERVICE_VERSION: z.string().default('0.0.0'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().default(''),
    OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),
    // Trust inbound W3C traceparent/baggage. Keep false on a public edge so clients can't inject or
    // collide trace ids / force sampling; set true only behind a trusted mesh/gateway that owns the
    // root span. Read by startTracing() via process.env; declared here for .env.example parity.
    OTEL_TRUST_INBOUND_TRACEPARENT: envFlag(false),
    // Push OTLP metrics from this process. Keep false in the API — @prometheus-io/client (/metrics) is
    // the metrics source of truth, so enabling both would double-count. Enable only in processes with
    // no Prometheus scrape endpoint (worker, scheduler). Read by startTracing() via process.env.
    OTEL_METRICS_EXPORT_ENABLED: envFlag(false),
    OTEL_DEBUG: envFlag(false),
  };
}

export function nodeEnvShape() {
  return {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
  };
}

export function sentryEnvShape(tracesSampleRateDefault: number) {
  return {
    SENTRY_DSN: z.string().optional().default(''),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(tracesSampleRateDefault),
    SENTRY_ENVIRONMENT: z.string().default('development'),
  };
}

export function mailEnvShape() {
  return {
    MAIL_HOST: z.string().default('localhost'),
    MAIL_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    MAIL_USER: z.string().default(''),
    MAIL_PASSWORD: z.string().default(''),
    MAIL_IGNORE_TLS: envFlag(true),
    MAIL_SECURE: envFlag(false),
    MAIL_REQUIRE_TLS: envFlag(false),
    MAIL_DEFAULT_EMAIL: z.email().default('noreply@example.com'),
    MAIL_DEFAULT_NAME: z.string().default('No Reply'),
  };
}

export function outboxRelayEnvShape() {
  return {
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
    OUTBOX_RETRY_BASE_MS: z.coerce.number().int().min(100).max(600_000).default(2_000),
    OUTBOX_RETRY_MAX_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
  };
}

export function outboxPurgeEnvShape() {
  return {
    // Hard-deletes processed outbox rows older than this; unprocessed rows are never touched.
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    OUTBOX_PURGE_BATCH_SIZE: z.coerce.number().int().min(100).max(10000).default(1000),
    OUTBOX_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10000).default(200),
  };
}

interface DatabasePoolBoundsEnv {
  DATABASE_POOL_MIN: number;
  DATABASE_POOL_MAX: number;
}

export function refineDatabasePoolBounds(data: DatabasePoolBoundsEnv, ctx: z.RefinementCtx): void {
  if (data.DATABASE_POOL_MIN > data.DATABASE_POOL_MAX) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_POOL_MIN'],
      message: 'DATABASE_POOL_MIN must be less than or equal to DATABASE_POOL_MAX',
    });
  }
}

interface OutboxRetryBoundsEnv {
  OUTBOX_RETRY_BASE_MS: number;
  OUTBOX_RETRY_MAX_MS: number;
}

export function refineOutboxRetryBounds(data: OutboxRetryBoundsEnv, ctx: z.RefinementCtx): void {
  if (data.OUTBOX_RETRY_BASE_MS > data.OUTBOX_RETRY_MAX_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['OUTBOX_RETRY_BASE_MS'],
      message: 'OUTBOX_RETRY_BASE_MS must be less than or equal to OUTBOX_RETRY_MAX_MS',
    });
  }
}

interface DatabaseUrlEnv {
  DATABASE_URL: string;
}

export function refineDatabaseUrlProd(data: DatabaseUrlEnv, ctx: z.RefinementCtx): void {
  if (!/^postgres(ql)?:\/\//.test(data.DATABASE_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL must use the postgres:// or postgresql:// scheme in production',
    });
  }
}

interface StorageCredentialsEnv {
  STORAGE_ACCESS_KEY: string;
  STORAGE_SECRET_KEY: string;
}

export function refineStorageProd(data: StorageCredentialsEnv, ctx: z.RefinementCtx): void {
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
}

interface RedisQueuePasswordEnv {
  REDIS_QUEUE_PASSWORD?: string | undefined;
}

export function refineRedisQueuePasswordProd(
  data: RedisQueuePasswordEnv,
  ctx: z.RefinementCtx,
): void {
  if (!data.REDIS_QUEUE_PASSWORD) {
    ctx.addIssue({
      code: 'custom',
      path: ['REDIS_QUEUE_PASSWORD'],
      message:
        'REDIS_QUEUE_PASSWORD must be set in production — an unauthenticated queue exposes every job payload and the DLQ',
    });
  }
}

interface MailProdEnv {
  MAIL_HOST: string;
  MAIL_DEFAULT_EMAIL: string;
  MAIL_USER: string;
  MAIL_IGNORE_TLS: boolean;
  MAIL_SECURE: boolean;
  MAIL_REQUIRE_TLS: boolean;
}

export function refineMailProd(data: MailProdEnv, ctx: z.RefinementCtx): void {
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

  // The rule's intent is to keep credentials off the wire, so it only applies when auth is
  // actually used (MAIL_USER set). A relay without auth (e.g. a local mailpit in a prod-parity
  // smoke) sends nothing secret in plaintext, so requiring TLS there adds no security — only friction.
  if (!data.MAIL_USER) return;

  if (data.MAIL_IGNORE_TLS) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_IGNORE_TLS'],
      message:
        'MAIL_IGNORE_TLS must be false in production when MAIL_USER is set — sending SMTP credentials without TLS exposes them in plaintext',
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

export function parseEnvOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  config: Record<string, unknown>,
  label: string,
): z.infer<Schema> {
  const result = schema.safeParse(stripEmptyEnvStrings(config));

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`${label} validation failed. Fix the following variables:\n${formatted}`);
  }

  return result.data;
}
