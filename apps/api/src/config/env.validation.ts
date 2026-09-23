import { z } from 'zod';
import {
  databaseEnvShape,
  envFlag,
  mailEnvShape,
  nodeEnvShape,
  otelEnvShape,
  outboxPurgeEnvShape,
  outboxRelayEnvShape,
  parseEnvOrThrow,
  redisQueueEnvShape,
  refineDatabasePoolBounds,
  refineDatabaseUrlProd,
  refineMailProd,
  refineOutboxRetryBounds,
  refineRedisQueuePasswordProd,
  refineStorageProd,
  sentryEnvShape,
  storageEnvShape,
} from '@nestjs-fastify-nx/shared';
// The package version is the single source of truth for APP_VERSION's default; nx release bumps it
// (and root) in lockstep. Operators can still override APP_VERSION/APP_NAME via env.
import pkg from '../../package.json';
import { isCompilableTrustedProxyList, parseTrustedProxies } from '../common/http/trusted-proxies';

const STORED_FILE_SIZE_COLUMN_MAX_BYTES = 2_147_483_647;

const envSchema = z
  .object({
    // Service identity — exposed at `GET /`. Defaults derive from the build; override via env.
    APP_NAME: z.string().default('nestjs-fastify-nx'),
    APP_VERSION: z.string().default(pkg.version),
    // Database
    ...databaseEnvShape('nestjs-fastify-api'),
    // Flips /health/dependencies to 503 when exceeded (NOT the readiness probe — see HealthController).
    // 30s suits most streaming replication topologies.
    DB_REPLICATION_LAG_THRESHOLD_MS: z.coerce.number().int().min(1_000).default(30_000),

    // Redis cache instance (rate-limit counters, idempotency replay, Socket.io pub/sub, health probe)
    REDIS_CACHE_HOST: z.string().default('localhost'),
    REDIS_CACHE_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_CACHE_PASSWORD: z.string().min(1).optional(),

    // Redis queue
    ...redisQueueEnvShape(),
    // Separate from cache (db=0) and BullMQ to avoid keyspace-event noise in pub/sub.
    REDIS_PUBSUB_DB: z.coerce.number().int().min(0).max(15).default(2),

    // Without a stable secret, sessions reset on every restart.
    BETTER_AUTH_SECRET: z.string().trim().min(32).optional(),
    BETTER_AUTH_URL: z.url().optional(),
    // SPA host that owns /reset, /verify-email, /delete-account pages. Required in production.
    FRONTEND_BASE_URL: z.url().optional(),
    // Social login — each provider activates only when BOTH id and secret are set.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    FACEBOOK_CLIENT_ID: z.string().optional(),
    FACEBOOK_CLIENT_SECRET: z.string().optional(),

    // Storage (S3 / MinIO)
    ...storageEnvShape(),
    UPLOAD_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
    MALWARE_SCANNER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    UPLOAD_MAX_FILES: z.coerce.number().int().min(1).max(100).default(10),
    UPLOAD_MAX_TOTAL_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(Number.MAX_SAFE_INTEGER)
      .default(1_073_741_824),
    UPLOAD_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(1000).default(4),
    UPLOAD_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(3_600_000).default(900_000),

    // Throttler
    THROTTLER_ENABLED: envFlag(true),
    THROTTLER_LIMIT: z.coerce.number().int().min(1).default(100),
    THROTTLER_TTL: z.coerce.number().int().min(1).default(60),

    // Mail
    ...mailEnvShape(),

    // App
    ...nodeEnvShape(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Defaults to every interface because a container must bind that way to be reachable through a
    // published port. Running on the host (./scripts/dev.sh) that also exposes the api to the local
    // network — set 127.0.0.1 to keep a laptop's dev stack off untrusted WiFi.
    HOST: z.string().default('0.0.0.0'),
    ERROR_DOCS_BASE_URL: z.url().optional(),
    HTTP_MAX_EVENT_LOOP_DELAY_MS: z.coerce.number().int().min(10).max(60_000).default(1_000),
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
    // Wrong value lets attacker spoof req.ip and bypass rate limits. Empty trusts no proxy at all.
    TRUST_PROXY_CIDRS: z
      .string()
      .default('')
      .transform(parseTrustedProxies)
      .refine(isCompilableTrustedProxyList, {
        message:
          'TRUST_PROXY_CIDRS must be a comma-separated list of IPs, CIDR ranges, or proxy-addr presets (loopback, linklocal, uniquelocal)',
      }),
    // Per-IP WebSocket cap — prevents a single client from OOMing the gateway.
    WS_CONNECTION_LIMIT_PER_IP: z.coerce.number().int().min(1).default(50),
    WS_SESSION_REVALIDATE_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
    // Caps concurrent Better Auth getSession() calls when the revalidation timer fires; combined
    // with per-socket jitter (spread across WS_SESSION_REVALIDATE_MS) to avoid a thundering herd.
    WS_SESSION_REVALIDATE_CONCURRENCY: z.coerce.number().int().min(1).max(1_000).default(20),
    // Per-socket inbound message budget. The global APP_GUARDs (throttler included) all bypass the
    // `ws` context, so without this an authenticated socket could flood @SubscribeMessage handlers
    // unbounded — the per-IP connection cap only limits how many sockets exist, not their traffic.
    WS_MESSAGE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(60),
    WS_MESSAGE_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(10_000),
    // Allow requests through when Redis is unreachable (brief unbounded rate) instead of cascading 500s.
    THROTTLER_FAIL_OPEN: envFlag(true),
    ENABLE_METRICS: envFlag(false),
    // Comma-separated CIDRs/IPs allowed to scrape /metrics. Loopback always allowed. Empty = loopback-only.
    METRICS_ALLOW_CIDRS: z.string().default(''),

    // OpenTelemetry
    ...otelEnvShape('nestjs-fastify-api'),
    // Only a trusted gateway should be allowed to assign the support/log lookup id.
    TRUST_INBOUND_REQUEST_ID: envFlag(false),

    // Domain event publisher
    EVENT_PUBLISHER_DRIVER: z.enum(['inprocess', 'outbox']).default('inprocess'),
    ...outboxRelayEnvShape(),
    ...outboxPurgeEnvShape(),

    // Monthly partitions kept; min=1 prevents zero-retention misconfiguration from purging the active partition.
    AUDIT_LOG_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(12),

    // Two-tier auth rate limit (bypasses NestJS ThrottlerGuard via reply.hijack). See main.ts.
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
    AUTH_IP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(50),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
    AUTH_SESSION_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
    AUTH_SESSION_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    AUTH_RATE_LIMIT_FAIL_OPEN: envFlag(false),

    HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
    UPLOAD_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(STORED_FILE_SIZE_COLUMN_MAX_BYTES)
      .default(10_485_760),

    // Caps handler execution time (504 on breach). 0 disables — set that only when a fronting
    // gateway already enforces its own timeout. Must stay below IDEMPOTENCY_LOCK_TTL_SECONDS so a
    // timed-out request releases its idempotency lock within the lock's lifetime.
    HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),

    // Idempotency-Key replay for mutating /api/v1/* requests (Stripe pattern).
    IDEMPOTENCY_ENABLED: envFlag(true),
    // How long a completed response is replayable. 24h matches Stripe.
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(1).default(86_400),
    // In-flight lock lifetime. Must exceed HTTP_REQUEST_TIMEOUT_MS so the finishing request always
    // owns its lock when it writes the result — preventing a lock-steal after expiry.
    IDEMPOTENCY_LOCK_TTL_SECONDS: z.coerce.number().int().min(1).default(60),

    // Bull Board
    BULL_BOARD_ENABLED: envFlag(true),
    BULL_BOARD_USER: z.string().default('admin'),
    BULL_BOARD_PASSWORD: z.string().default('admin'),

    // Validated here for .env.example parity; the worker process is the runtime consumer.
    WORKER_EMAIL_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(5),
    WORKER_UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(5),

    // 0.01 (1%) default — 0.1 at 1k RPS burns 26M traces/day, exceeding most Business-plan quotas.
    ...sentryEnvShape(0.01),
  })
  .superRefine((data, ctx) => {
    // Mirrors the scheduler validator. The relay only runs there, but api and scheduler share one
    // .env in production — so without this check the same file boots green here and is rejected
    // there, which reads as an api/scheduler discrepancy rather than the config error it is.
    refineOutboxRetryBounds(data, ctx);
    refineDatabasePoolBounds(data, ctx);

    // A timed-out request must release its idempotency lock before the lock expires, otherwise a
    // slow completion could overwrite a newer request's lock. Only enforced when both are active.
    if (
      data.IDEMPOTENCY_ENABLED &&
      data.HTTP_REQUEST_TIMEOUT_MS > 0 &&
      data.HTTP_REQUEST_TIMEOUT_MS >= data.IDEMPOTENCY_LOCK_TTL_SECONDS * 1000
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDEMPOTENCY_LOCK_TTL_SECONDS'],
        message:
          'IDEMPOTENCY_LOCK_TTL_SECONDS (ms) must be greater than HTTP_REQUEST_TIMEOUT_MS so a timed-out request releases its lock in time',
      });
    }

    if (data.NODE_ENV !== 'production') return;

    refineStorageProd(data, ctx);
    refineRedisQueuePasswordProd(data, ctx);
    refineDatabaseUrlProd(data, ctx);
    refineMailProd(data, ctx);

    if (data.BULL_BOARD_PASSWORD === 'admin') {
      ctx.addIssue({
        code: 'custom',
        path: ['BULL_BOARD_PASSWORD'],
        message: 'Must not use default password in production',
      });
    }
    if (!data.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_SECRET'],
        message: 'BETTER_AUTH_SECRET must be set in production for stable session signing',
      });
    }
    if (!data.REDIS_CACHE_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_CACHE_PASSWORD'],
        message:
          'REDIS_CACHE_PASSWORD must be set in production — the cache holds session rate-limit and idempotency keys',
      });
    }
    if (!data.BETTER_AUTH_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message: 'BETTER_AUTH_URL must be set in production to a stable public API origin',
      });
    }
    if (!data.FRONTEND_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['FRONTEND_BASE_URL'],
        message: 'FRONTEND_BASE_URL must be set in production for email action links',
      });
    }

    // In-process publishing (EventEmitter2) loses domain events on crash/rollback. Production must use
    // the transactional outbox so events survive process death — matches the documented architecture.
    if (data.EVENT_PUBLISHER_DRIVER !== 'outbox') {
      ctx.addIssue({
        code: 'custom',
        path: ['EVENT_PUBLISHER_DRIVER'],
        message:
          'EVENT_PUBLISHER_DRIVER must be "outbox" in production for durable, crash-safe event delivery',
      });
    }

    if (data.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must list at least one allowed origin in production',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateConfig(config: Record<string, unknown>): EnvConfig {
  return parseEnvOrThrow(envSchema, config, 'Environment');
}
