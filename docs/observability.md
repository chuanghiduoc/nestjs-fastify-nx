# Observability

How the API emits logs, traces and metrics, and how they correlate. Three signals, one id.

## The correlation id

Every request is identified by one id shared across all three signals and the HTTP boundary:

- **`X-Request-Id`** (response header + `requestId` in error bodies) defaults to the active
  **OpenTelemetry trace id** (W3C 128-bit hex). So the value in a client's response header is
  the same id you search for in the trace backend and in the logs — no mapping table.
- Precedence: client-supplied `X-Request-Id` → active `trace_id` → random 128-bit hex
  (`generateCorrelationId()`, only when tracing is disabled). Set in `CorrelationIdMiddleware`
  and mirrored by `fastify-error-handler` for Fastify-level failures.
- **`X-Correlation-Id`** spans a client journey (multiple requests). It defaults to the
  request id when the client omits it; a client that wants to tie several calls together sends
  its own stable value.

> UUIDv7 (`generateId()`) is used for **database primary keys** — its time ordering keeps
> B-tree indexes compact. It is deliberately **not** used for correlation ids, where matching
> the trace-id hex shape matters more than sortability.

## Structured logging (pino)

`nestjs-pino` + `pino-http`, configured in `libs/infra/observability/pino-logger-config.ts`.

- **Dev**: `pino-pretty`, colourised, single-line, numeric level.
- **Prod**: raw JSON with the level as a string label (`"level":"info"`) — what Loki / ELK /
  Datadog / GCP index on.
- **Every line carries** `service`, `env`, `pid`, `hostname` (base fields) plus `trace_id` /
  `span_id` (injected by the OTel pino instrumentation) and top-level `correlationId` /
  `requestId` (customProps). Pivot from any log line to its trace by `trace_id`.
- **Compact serializers**: requests log `{ method, url, remoteAddress }` and responses
  `{ statusCode }` — not the full header/body dump. Smaller lines, smaller PII surface;
  `responseTime` is still emitted at top level.
- **Probe noise dropped**: `autoLogging.ignore` skips `/metrics` and `/api/v1/health*` so
  Kubernetes/Prometheus polling doesn't bury real traffic (the trace still records them).
- **Redaction**: `SENSITIVE_REDACT_PATHS` (`libs/shared/logger-redact.ts`) censors auth
  headers, cookies, and any `*.password` / `*.token` / `*.sessionToken` / `*.secret` key.
- `LOG_LEVEL` sets the threshold (default `info`).

## Distributed tracing (OpenTelemetry)

`libs/infra/observability/start-tracing.ts`, imported first in each app's `main.ts` so the SDK
patches `http`/`pg`/`ioredis` before they load. Enabled by `OTEL_ENABLED=true`.

- **Resource**: `service.name`, `service.namespace`, `service.version`, `deployment.environment`.
- **Exporters**: OTLP/HTTP for traces and metrics (`OTEL_EXPORTER_OTLP_ENDPOINT`).
- **Sampling**: `TraceIdRatioBasedSampler` via `OTEL_TRACES_SAMPLER_RATIO` (default `1`).
- **Auto-instrumentation**: HTTP, Postgres, ioredis, pino (log injection). `fs` is disabled.
- Graceful shutdown on `SIGTERM`/`SIGINT`.

Local stack: `docker compose -f docker/compose.yml -f docker/compose.dev.yml -f docker/compose.observability.yml up`
brings up OTel Collector + Jaeger + Prometheus + Grafana (all bound to `127.0.0.1`).

## Metrics (Prometheus)

`prom-client` registry exposed at `/metrics`, guarded by `MetricsIpAllowGuard`
(`METRICS_ALLOW_CIDRS`, reads `socket.remoteAddress`, fails closed). Key series:

- `http_requests_total`, `http_request_duration_seconds` (labels: method, route, status_code)
- `bullmq_jobs_total`, `bullmq_job_duration_seconds`, `bullmq_queue_depth`
- `outbox_lag_seconds` — age of the oldest unprocessed outbox event

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
