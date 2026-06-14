import { z } from 'zod';

const envSchema = z
  .object({
    // Database
    DATABASE_URL: z.string().trim().min(1),
    // Prisma CLI uses this to bypass transaction-mode poolers (pgbouncer, RDS Proxy) for migrations.
    DATABASE_DIRECT_URL: z.string().trim().min(1).optional(),
    // Physical replica for read-only queries. When unset, dbRead aliases to db.
    DATABASE_REPLICA_URL: z.string().trim().min(1).optional(),
    DATABASE_REPLICA_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(10),
    // Flips /health/ready to 503 when exceeded. 30s suits most streaming replication topologies.
    DB_REPLICATION_LAG_THRESHOLD_MS: z.coerce.number().int().min(1_000).default(30_000),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(1000).default(0),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    DATABASE_APPLICATION_NAME: z.string().default('nestjs-fastify-api'),

    // Redis cache
    REDIS_CACHE_HOST: z.string().default('localhost'),
    REDIS_CACHE_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_CACHE_TTL_MS: z.coerce.number().default(300000),

    // Redis queue
    REDIS_QUEUE_HOST: z.string().default('localhost'),
    REDIS_QUEUE_PORT: z.coerce.number().int().min(1).max(65535).default(6380),
    REDIS_QUEUE_PREFIX: z.string().default('bull'),
    // Separate from cache (db=0) and BullMQ to avoid keyspace-event noise in pub/sub.
    REDIS_PUBSUB_DB: z.coerce.number().int().min(0).max(15).default(2),

    // Without a stable secret, sessions reset on every restart.
    BETTER_AUTH_SECRET: z.string().trim().min(32).optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    // SPA host that owns /reset, /verify-email, /delete-account pages. Required in production.
    FRONTEND_BASE_URL: z.string().url().optional(),

    // Storage (S3 / MinIO)
    STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
    STORAGE_BUCKET: z.string().default('uploads'),
    STORAGE_REGION: z.string().default('us-east-1'),
    STORAGE_ACCESS_KEY: z.string().default('minioadmin'),
    STORAGE_SECRET_KEY: z.string().default('minioadmin'),

    // Throttler
    THROTTLER_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    THROTTLER_LIMIT: z.coerce.number().int().min(1).default(100),
    THROTTLER_TTL: z.coerce.number().int().min(1).default(60),

    // Mail
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
    MAIL_DEFAULT_EMAIL: z.string().email().default('noreply@example.com'),
    MAIL_DEFAULT_NAME: z.string().default('No Reply'),

    // App
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.string().default('info'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      ),
    // Wrong value lets attacker spoof req.ip and bypass rate limits. 1=single proxy, 2=Cloudflare+ingress.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
    // Per-IP WebSocket cap — prevents a single client from OOMing the gateway.
    WS_CONNECTION_LIMIT_PER_IP: z.coerce.number().int().min(1).default(50),
    // Allow requests through when Redis is unreachable (brief unbounded rate) instead of cascading 500s.
    THROTTLER_FAIL_OPEN: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    ENABLE_METRICS: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    // Comma-separated CIDRs/IPs allowed to scrape /metrics. Loopback always allowed. Empty = loopback-only.
    METRICS_ALLOW_CIDRS: z.string().default(''),

    // OpenTelemetry
    OTEL_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    OTEL_SERVICE_NAME: z.string().default('nestjs-fastify-api'),
    OTEL_SERVICE_NAMESPACE: z.string().default('app'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().default(''),
    OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),

    // Domain event publisher
    EVENT_PUBLISHER_DRIVER: z.enum(['inprocess', 'outbox']).default('inprocess'),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(1_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(1_000).default(10),

    // Monthly partitions kept; min=1 prevents zero-retention misconfiguration from purging the active partition.
    AUDIT_LOG_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(12),

    // Hard-deletes processed outbox rows older than this; unprocessed rows are never touched.
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    OUTBOX_PURGE_BATCH_SIZE: z.coerce.number().int().min(100).max(10000).default(1000),
    OUTBOX_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(10000).default(200),

    // Two-tier auth rate limit (bypasses NestJS ThrottlerGuard via reply.hijack). See main.ts.
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
    AUTH_SESSION_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
    AUTH_SESSION_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),

    HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
    UPLOAD_MAX_FILE_BYTES: z.coerce.number().int().min(1024).default(10_485_760),

    // Bull Board
    BULL_BOARD_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    BULL_BOARD_USER: z.string().default('admin'),
    BULL_BOARD_PASSWORD: z.string().default('admin'),

    // Validated here for .env.example parity; the worker process is the runtime consumer.
    WORKER_EMAIL_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(5),
    WORKER_UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(5),

    // 0.01 (1%) default — 0.1 at 1k RPS burns 26M traces/day, exceeding most Business-plan quotas.
    SENTRY_DSN: z.string().optional().default(''),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.01),
    SENTRY_ENVIRONMENT: z.string().default('development'),
  })
  .superRefine((data, ctx) => {
    if (data.DATABASE_POOL_MIN > data.DATABASE_POOL_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_POOL_MIN'],
        message: 'DATABASE_POOL_MIN must be less than or equal to DATABASE_POOL_MAX',
      });
    }

    if (data.NODE_ENV !== 'production') return;

    if (data.STORAGE_ACCESS_KEY === 'minioadmin') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_ACCESS_KEY'],
        message: 'Must not use default value in production',
      });
    }
    if (data.STORAGE_SECRET_KEY === 'minioadmin') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_SECRET_KEY'],
        message: 'Must not use default value in production',
      });
    }
    if (data.BULL_BOARD_PASSWORD === 'admin') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BULL_BOARD_PASSWORD'],
        message: 'Must not use default password in production',
      });
    }
    if (!data.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET must be set in production for stable session signing',
      });
    }

    if (!/^postgres(ql)?:\/\//.test(data.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must use the postgres:// or postgresql:// scheme in production',
      });
    }

    if (data.MAIL_HOST === 'localhost') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_HOST'],
        message: 'MAIL_HOST must point to a real SMTP server in production',
      });
    }

    if (data.MAIL_DEFAULT_EMAIL === 'noreply@example.com') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_DEFAULT_EMAIL'],
        message: 'MAIL_DEFAULT_EMAIL must be set to a real address in production',
      });
    }

    // SMTP runs in the worker, but api and worker share one .env in prod, so
    // both validators enforce TLS to keep credentials off the wire.
    if (data.MAIL_IGNORE_TLS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_IGNORE_TLS'],
        message:
          'MAIL_IGNORE_TLS must be false in production — sending SMTP credentials without TLS exposes them in plaintext',
      });
    }
    if (!data.MAIL_SECURE && !data.MAIL_REQUIRE_TLS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_REQUIRE_TLS'],
        message: 'Enable MAIL_SECURE or MAIL_REQUIRE_TLS in production so SMTP negotiates TLS',
      });
    }

    if (data.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must list at least one allowed origin in production',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

// dotenv loads `KEY=` as `""` not `undefined`, so optional().min(32) would silently pass.
// Stripping empty strings lets optional fields fall back to defaults and required fields fail loudly.
function stripEmptyStrings(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return out;
}

export function validateConfig(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(stripEmptyStrings(config));

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed. Fix the following variables:\n${formatted}`);
  }

  return result.data;
}
