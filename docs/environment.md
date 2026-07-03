# Environment Variables

Copy `.env.example` to `.env` and fill in the values.

## Database

| Variable                         | Default                                                   | Required    | Description                    |
| -------------------------------- | --------------------------------------------------------- | ----------- | ------------------------------ |
| `DATABASE_URL`                   | `postgresql://postgres:postgres@localhost:5432/nestjs_db` | Yes         | PostgreSQL connection string   |
| `DATABASE_POOL_MAX`              | `20`                                                      | No          | Max pool connections           |
| `DATABASE_POOL_MIN`              | `0`                                                       | No          | Min pool connections           |
| `DATABASE_IDLE_TIMEOUT_MS`       | `10000`                                                   | No          | Idle connection timeout        |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `5000`                                                    | No          | Connection acquire timeout     |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | `30000`                                                   | No          | Per-statement timeout          |
| `DATABASE_APPLICATION_NAME`      | `nestjs-fastify-api`                                      | No          | Surfaced in `pg_stat_activity` |
| `POSTGRES_USER`                  | `postgres`                                                | Docker only | DB username for Compose        |
| `POSTGRES_PASSWORD`              | `postgres`                                                | Docker only | DB password for Compose        |
| `POSTGRES_DB`                    | `nestjs_db`                                               | Docker only | Database name for Compose      |
| `POSTGRES_PORT`                  | `5432`                                                    | Docker only | Host port for Compose          |

## Redis

| Variable             | Default     | Required | Description                                  |
| -------------------- | ----------- | -------- | -------------------------------------------- |
| `REDIS_CACHE_HOST`   | `localhost` | Yes      | Cache Redis hostname                         |
| `REDIS_CACHE_PORT`   | `6379`      | Yes      | Cache Redis port                             |
| `REDIS_CACHE_TTL_MS` | `300000`    | No       | Default cache TTL                            |
| `REDIS_QUEUE_HOST`   | `localhost` | Yes      | Queue Redis hostname                         |
| `REDIS_QUEUE_PORT`   | `6380`      | Yes      | Queue Redis port                             |
| `REDIS_QUEUE_PREFIX` | `bull`      | No       | BullMQ key prefix                            |
| `REDIS_PUBSUB_DB`    | `2`         | No       | Redis DB index used by the Socket.io adapter |

## Storage (MinIO / S3)

| Variable             | Default                 | Required             | Description            |
| -------------------- | ----------------------- | -------------------- | ---------------------- |
| `STORAGE_ENDPOINT`   | `http://localhost:9000` | Yes                  | S3-compatible endpoint |
| `STORAGE_ACCESS_KEY` | `minioadmin`            | Yes (rotate in prod) | Access key             |
| `STORAGE_SECRET_KEY` | `minioadmin`            | Yes (rotate in prod) | Secret key             |
| `STORAGE_BUCKET`     | `uploads`               | Yes                  | Default bucket name    |
| `STORAGE_REGION`     | `us-east-1`             | No                   | S3 region              |

**Upload pattern** — clients call `POST /api/v1/upload/presign` to receive a
short-lived (5 min) S3 presigned-POST policy, upload the bytes browser→S3
directly, then call `POST /api/v1/upload/confirm` so the server HEADs the
object and verifies size + MIME via magic-byte detection
(`libs/modules/upload/src/presentation/controllers/file-signature.ts`). The
allow-list is hard-coded to `image/jpeg`, `image/png`, `image/gif`,
`image/webp`, `application/pdf`. Both the multipart parser and the presign
policy honour `UPLOAD_MAX_FILE_BYTES` so the two layers reject at the same
threshold.

## Authentication (Better Auth)

Auth is handled by [Better Auth](https://www.better-auth.com/) using cookie
sessions backed by Postgres. There are no JWT secrets — Better Auth derives
session tokens from `BETTER_AUTH_SECRET` and stores them in the `Session`
table. Credentials live in the `Account` table (provider `credential`,
scrypt-hashed via `better-auth/crypto`).

| Variable             | Default                                                                        | Required   | Description                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | —                                                                              | Yes        | Min 32 chars; signs cookies and derives session tokens                                                                                                                                                               |
| `BETTER_AUTH_URL`    | —                                                                              | Prod       | Public origin used to build cookie scope and trusted-origin list                                                                                                                                                     |
| `FRONTEND_BASE_URL`  | dev: falls back to `BETTER_AUTH_URL` w/ warning; **prod: boot fails if unset** | Yes (prod) | SPA origin that renders `/reset`, `/verify-email`, `/delete-account` pages. The SPA pulls `?token=` from the URL, shows a form, and POSTs to the matching `/api/auth/*` endpoint. Backend has no UI for these flows. |
| `CORS_ORIGINS`       | —                                                                              | Prod       | Comma-separated allowed origins; required for cookie-bearing CORS and Socket.io upgrades                                                                                                                             |

## Application

| Variable            | Default       | Required | Description                                                     |
| ------------------- | ------------- | -------- | --------------------------------------------------------------- |
| `NODE_ENV`          | `development` | No       | `development` or `production`                                   |
| `PORT`              | `3000`        | No       | HTTP port                                                       |
| `TZ`                | `UTC`         | No       | IANA timezone resolved by Node (requires `tzdata` in the image) |
| `THROTTLER_ENABLED` | `true`        | No       | Toggle the global rate limiter                                  |
| `THROTTLER_LIMIT`   | `100`         | No       | Requests per window                                             |
| `THROTTLER_TTL`     | `60`          | No       | Window length in seconds                                        |

## Rate Limiting & Request Body Limits

Two-tier auth rate limit (Auth0/Cognito pattern). STRICT bucket guards
credential endpoints (`sign-in`, `sign-up`, `forget-password`, `reset-password`)
keyed by IP + email; LOOSE bucket guards session ops (`sign-out`, `get-session`,
`list-sessions`, …) keyed by IP only. Both are enforced by `@fastify/rate-limit`
because `reply.hijack()` bypasses the NestJS ThrottlerGuard.

| Variable                            | Default    | Required | Description                                                                  |
| ----------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------- |
| `AUTH_RATE_LIMIT_MAX`               | `5`        | No       | STRICT: max requests per window on credential paths (per IP+email)           |
| `AUTH_RATE_LIMIT_WINDOW_MS`         | `900000`   | No       | STRICT window in milliseconds (15 min default)                               |
| `AUTH_SESSION_RATE_LIMIT_MAX`       | `60`       | No       | LOOSE: max requests per window on other `/api/auth/*` paths (per IP)         |
| `AUTH_SESSION_RATE_LIMIT_WINDOW_MS` | `60000`    | No       | LOOSE window in milliseconds (60 sec default)                                |
| `HTTP_BODY_LIMIT_BYTES`             | `1048576`  | No       | Max raw JSON request body size (1 MB default)                                |
| `UPLOAD_MAX_FILE_BYTES`             | `10485760` | No       | Max multipart file size (10 MB default); pinned in S3 presigned-POST policy  |
| `HTTP_MAX_EVENT_LOOP_DELAY_MS`      | `1000`     | No       | `@fastify/under-pressure` load-shed threshold; over this the API replies 503 |

## Error documentation

| Variable              | Default              | Required | Description                                                                                                                                                                                                                                                                                   |
| --------------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERROR_DOCS_BASE_URL` | `/errors` (relative) | No       | Base URL used to build the `type` field of RFC 9457 Problem Details responses (`<base>/<code-with-dashes>`). RFC 9457 §3.1 allows relative URIs — leave unset in dev. Set to an absolute URL (e.g. `https://docs.example.com/errors`) in production if you publish error documentation pages. |

## Mail (SMTP)

| Variable             | Default               | Required                   | Description                                          |
| -------------------- | --------------------- | -------------------------- | ---------------------------------------------------- |
| `MAIL_HOST`          | `localhost`           | Yes (real host in prod)    | SMTP host; must point at a real server in production |
| `MAIL_PORT`          | `1025`                | Yes                        | SMTP port                                            |
| `MAIL_USER`          | —                     | No                         | SMTP username                                        |
| `MAIL_PASSWORD`      | —                     | No                         | SMTP password                                        |
| `MAIL_IGNORE_TLS`    | `true`                | No                         | Skip STARTTLS (Mailpit/dev only)                     |
| `MAIL_SECURE`        | `false`               | No                         | Use TLS on connect (port 465)                        |
| `MAIL_REQUIRE_TLS`   | `false`               | No                         | Force STARTTLS upgrade                               |
| `MAIL_DEFAULT_EMAIL` | `noreply@example.com` | Yes (real address in prod) | Default `From:` address                              |
| `MAIL_DEFAULT_NAME`  | `No Reply`            | No                         | Default `From:` display name                         |

## Seeding

| Variable              | Default | Required     | Description                                                                        |
| --------------------- | ------- | ------------ | ---------------------------------------------------------------------------------- |
| `RUN_SEED`            | `false` | No           | When `true`, the migration container runs `prisma/seed.mjs` after `migrate deploy` |
| `SEED_ADMIN_EMAIL`    | —       | When seeding | Admin email; the seed creates a `User` + `Account` row pair                        |
| `SEED_ADMIN_PASSWORD` | —       | When seeding | Admin password, scrypt-hashed via `better-auth/crypto`                             |

## Eventing & Outbox

| Variable                  | Default     | Required | Description                                                                 |
| ------------------------- | ----------- | -------- | --------------------------------------------------------------------------- |
| `EVENT_PUBLISHER_DRIVER`  | `inprocess` | No       | `inprocess` (EventEmitter2) or `outbox` (Postgres outbox + scheduler relay) |
| `OUTBOX_TX_TIMEOUT_MS`    | `30000`     | No       | Outbox interactive tx timeout (30 sec); increase if events hang in publish  |
| `OUTBOX_POLL_INTERVAL_MS` | `1000`      | No       | Relay polling cadence                                                       |
| `OUTBOX_BATCH_SIZE`       | `50`        | No       | Max events relayed per poll                                                 |
| `OUTBOX_MAX_ATTEMPTS`     | `10`        | No       | Retry budget before an event is parked                                      |

## Bull Board

| Variable              | Default | Required             | Description                                                           |
| --------------------- | ------- | -------------------- | --------------------------------------------------------------------- |
| `BULL_BOARD_ENABLED`  | `true`  | No                   | Mount `/api/admin/queues`                                             |
| `BULL_BOARD_USER`     | `admin` | Yes (rotate in prod) | Basic-auth username                                                   |
| `BULL_BOARD_PASSWORD` | `admin` | Yes (rotate in prod) | Basic-auth password; the env validator rejects defaults in production |

## Observability

| Variable                      | Default                 | Required | Description                                                          |
| ----------------------------- | ----------------------- | -------- | -------------------------------------------------------------------- |
| `LOG_LEVEL`                   | `info`                  | No       | pino log level: `trace`, `debug`, `info`, `warn`, `error`            |
| `ENABLE_METRICS`              | `false`                 | No       | Expose `/metrics` for Prometheus (excluded from `api/v1` prefix)     |
| `METRICS_ALLOW_CIDRS`         | —                       | No       | Comma-separated CIDR ranges allowed to hit `/metrics` (empty=closed) |
| `OTEL_ENABLED`                | `false`                 | No       | Bootstrap the OpenTelemetry SDK                                      |
| `OTEL_SERVICE_NAME`           | `nestjs-fastify-api`    | No       | Reported service name                                                |
| `OTEL_SERVICE_NAMESPACE`      | `app`                   | No       | Reported service namespace                                           |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | No       | OTLP/HTTP collector endpoint                                         |
| `OTEL_EXPORTER_OTLP_HEADERS`  | —                       | No       | Optional collector auth headers                                      |
| `OTEL_TRACES_SAMPLER_RATIO`   | `1`                     | No       | Trace sampling ratio                                                 |
| `OTEL_DEBUG`                  | `false`                 | No       | Verbose SDK logging                                                  |
| `SENTRY_DSN`                  | —                       | No       | Sentry DSN; leave empty to disable                                   |
| `SENTRY_TRACES_SAMPLE_RATE`   | `0.1`                   | No       | Sentry tracing sample rate                                           |
| `SENTRY_ENVIRONMENT`          | `development`           | No       | Reported Sentry environment tag                                      |

## CI / Nx Cloud

| Variable              | Default | Required | Description                            |
| --------------------- | ------- | -------- | -------------------------------------- |
| `NX_CLOUD_AUTH_TOKEN` | —       | No       | Auth token for Nx Cloud remote caching |

## Docker images

| Variable          | Default   | Required | Description                                  |
| ----------------- | --------- | -------- | -------------------------------------------- |
| `IMAGE_REGISTRY`  | `ghcr.io` | No       | Container registry used by the compose files |
| `IMAGE_NAMESPACE` | —         | No       | Owner/org segment of the image reference     |
| `IMAGE_TAG`       | `latest`  | No       | Image tag pulled in production               |
| `API_PORT`        | `3000`    | No       | Host port mapped to the API container        |
| `API_DEBUG_PORT`  | `9229`    | No       | Host port mapped to the Node inspector (dev) |
