# Observability

How the API emits logs, traces and metrics, and how they correlate. Three signals, one id.

## The correlation id

Every request is identified by one id shared across all three signals and the HTTP boundary:

- **`X-Request-Id`** (response header + `requestId` in error bodies) defaults to the active
  **OpenTelemetry trace id** (W3C 128-bit hex). So the value in a client's response header is
  the same id you search for in the trace backend and in the logs — no mapping table.
- Precedence: client-supplied `X-Request-Id` → active `trace_id` → random 128-bit hex
  (`generateCorrelationId()`, when no valid trace id is available). Set in `CorrelationIdMiddleware`
  and mirrored by `fastify-error-handler` for Fastify-level failures.
- **`X-Correlation-Id`** spans a client journey (multiple requests). It defaults to the
  request id when the client omits it; a client that wants to tie several calls together sends
  its own stable value.

> UUIDv7 (`generateId()`) is used for **database primary keys** — its time ordering keeps
> B-tree indexes compact. It is deliberately **not** used for correlation ids, where matching
> the trace-id hex shape matters more than sortability.

## Structured logging (pino)

`nestjs-pino` + `pino-http`, configured in `libs/infra/observability/src/lib/pino-logger-config.ts`.

- **Dev**: `pino-pretty`, colourised, single-line, numeric level.
- **Prod**: raw JSON with the level as a string label (`"level":"info"`) — what Loki / ELK /
  Datadog / GCP index on.
- **Every line carries** `service`, `env`, `pid`, `hostname` (base fields), `trace_id` /
  `span_id` (injected by the OTel pino instrumentation, when tracing is on), and — via an
  **AsyncLocalStorage request context** (`nestjs-cls`) surfaced by a pino `mixin` — top-level
  `requestId`, `correlationId`, and `userId` on **every** log line, not just the HTTP access
  log. A command handler, repository, or event listener logs with the same request context
  **even when `OTEL_ENABLED=false`**. The mixin is a no-op in apps that never seed the store
  (worker/scheduler) and is additive to — never clobbers — the OTel trace fields. Pivot from
  any log line to its trace by `trace_id`, or to its request by `requestId`.
- **Slow-query log** — `PrismaService` emits a `warn` (query template + duration only, **never**
  bound params) when a query exceeds `DATABASE_SLOW_QUERY_MS` (default 200 ms), giving DB-latency
  visibility that works even with tracing disabled.
- **Compact serializers**: requests log `{ method, url, remoteAddress }` and responses
  `{ statusCode }` — not the full header/body dump. Smaller lines, smaller PII surface;
  `responseTime` is still emitted at top level.
- **Probe noise dropped**: `autoLogging.ignore` skips `/metrics` and `/api/v1/health*` so
  Kubernetes/Prometheus polling doesn't bury real traffic (the trace still records them).
- **Redaction**: `SENSITIVE_REDACT_PATHS` (`libs/shared/src/lib/logger-redact.ts`) censors auth
  headers, cookies, and any `*.password` / `*.token` / `*.sessionToken` / `*.secret` key.
- `LOG_LEVEL` sets the threshold (default `info`).

## Distributed tracing (OpenTelemetry)

`libs/infra/observability/start-tracing.ts`, imported first in each app's `main.ts` so the SDK
patches `http`/`pg`/`ioredis` before they load. Enabled by `OTEL_ENABLED=true`.

- **Resource**: `service.name`, `service.namespace`, `service.version`, `deployment.environment`.
- **Exporters**: OTLP/HTTP for traces and metrics (`OTEL_EXPORTER_OTLP_ENDPOINT`).
- **Sampling**: `TraceIdRatioBasedSampler` via `OTEL_TRACES_SAMPLER_RATIO` (default `1`).
- **Auto-instrumentation**: HTTP, Postgres, ioredis, GraphQL, socket.io, pino (log injection).
  `fs` is disabled.
- **CQRS use-case spans** — auto-instrumentation stops at the framework boundary (HTTP/DB/redis),
  so a traced `CommandBus`/`QueryBus` (`libs/core`) wraps every dispatch in a `command.<Name>` /
  `query.<Name>` span. This is where a slow request is attributed to a **specific handler**
  instead of "the whole HTTP call". Records exceptions + `ERROR` status on failure. Deliberately
  **not** added to HTTP/DB/redis (already auto-instrumented — would double-span); a cheap no-op
  when tracing is off (the OTel API's default no-op tracer).
- Graceful shutdown on `SIGTERM`/`SIGINT`.

Local stack: `docker compose -f docker/compose.yml -f docker/compose.dev.yml -f docker/compose.observability.yml up`
brings up OTel Collector + Jaeger + Prometheus + Grafana (all bound to `127.0.0.1`).

## Metrics (Prometheus)

`prom-client` registry exposed at `/metrics`, guarded by `MetricsIpAllowGuard`
(`METRICS_ALLOW_CIDRS`, reads `socket.remoteAddress`, fails closed). Key series:

- `http_requests_total`, `http_request_duration_seconds` (labels: method, route, status_code)
- `bullmq_jobs_total`, `bullmq_job_duration_seconds`, `bullmq_queue_depth`
- `outbox_lag_seconds` — age of the oldest unprocessed outbox event
- `cqrs_commands_total`, `cqrs_queries_total` (labels: name, status), `cqrs_duration_seconds` —
  per-use-case RED metrics recorded by the traced bus above (present only when `ENABLE_METRICS=true`)

Alert rules ship in `docker/prometheus/alert_rules.yml`; dashboards in
`docker/grafana/provisioning/dashboards/`. Because every API replica observes the same
BullMQ QueueEvents stream, aggregate counter/gauge series with `max by (...)`, not `sum`.

## Health

Split for Kubernetes (`apps/api/.../health.controller.ts`):

- `GET /api/v1/health/live` — process only, no dependencies.
- `GET /api/v1/health/ready` — DB + Redis (cache & queue) + BullMQ + PgBouncer + replication lag.
- `GET /api/v1/health` — full dependency check.

## Resilience

- **Load shedding** — `@fastify/under-pressure` replies `503` (problem+json, `Retry-After`)
  when the event loop stalls past 1 s, so a load balancer drains the instance instead of
  queueing work it can't serve.
- **Compression** — `@fastify/compress` gzips JSON/GraphQL responses over 1 KB.
- **Rate limiting** — two-tier `@fastify/rate-limit` on `/api/auth/*` (see `docs/security.md`).
