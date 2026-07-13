# Observability

How the API emits logs, traces and metrics, and how they correlate. Three signals, one id.

> **Operational how-to** (enable the local stack, explore the UIs, add a metric/span/log
> field/alert/dashboard, verify end-to-end) lives in [`observability-guide.md`](./observability-guide.md).
> This file covers the design and rationale.

## The correlation id

Every request is identified by one id shared across all three signals and the HTTP boundary:

- **`X-Request-Id`** (response header + `requestId` in error bodies) defaults to the active
  **OpenTelemetry trace id** (W3C 128-bit hex). So the value in a client's response header is
  the same id you search for in the trace backend and in the logs — no mapping table. It is a
  **search key only** — it never controls the trace context (that is owned by OTel; see tracing).
- Precedence: **validated** client-supplied `X-Request-Id` → active `trace_id` → random 128-bit
  hex (`generateCorrelationId()`, when no valid trace id is available). Set in
  `CorrelationIdMiddleware` / the CLS setup and mirrored by `fastify-error-handler` for
  Fastify-level failures.
- **Client ids are sanitized at the boundary** (`sanitizeClientId`, `request-id.ts`): only
  `[A-Za-z0-9._~-]{1,128}` is accepted. Anything with a newline/control char (log-injection
  vector) or over the length cap (log/trace-storage bloat) is discarded and a fresh id is minted —
  the raw client value never reaches a log line or span attribute.
- **`X-Correlation-Id`** spans a client journey (multiple requests). Same sanitization; defaults to
  the request id when the client omits it. A client that wants to tie several calls together sends
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
  `requestId`, `correlationId`, and `userId` on **every log line emitted within an active
  request context** (not just the HTTP access log). A command handler, repository, or event
  listener logs with the same request context **even when `OTEL_ENABLED=false`**. Startup and
  background (non-request) logs simply omit these fields — the mixin is a no-op with no store. The mixin is a no-op in apps that never seed the store
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
- **Exporters**: OTLP/HTTP for traces (`OTEL_EXPORTER_OTLP_ENDPOINT`). OTLP **metric** push is
  opt-in via `OTEL_METRICS_EXPORT_ENABLED` (see Metrics — off in the API, on in worker/scheduler).
- **Sampling**: `ParentBasedSampler(root = TraceIdRatioBasedSampler(OTEL_TRACES_SAMPLER_RATIO))`.
  ParentBased is deliberate: the ratio only decides for a **new** root trace; a child span always
  **honors the parent's sampled flag**, so cross-service traces don't come back with holes (a bare
  ratio sampler lets a downstream service drop spans its parent kept). Default ratio `1`.
- **Inbound trace context is not trusted by default** (`OTEL_TRUST_INBOUND_TRACEPARENT=false`).
  On a public edge the propagator still **injects** our context downstream but **ignores** any
  inbound `traceparent`/`baggage`, so external callers can't inject or collide trace ids, force the
  sampling decision, or smuggle baggage. Set `true` only behind a trusted mesh/gateway that owns the
  root span; then the ParentBased sampler honors the upstream decision as intended.
- **Auto-instrumentation**: HTTP, Postgres, ioredis, GraphQL, socket.io, pino (log injection).
  `fs` is disabled.
- **CQRS use-case spans** — auto-instrumentation stops at the framework boundary (HTTP/DB/redis),
  so a traced `CommandBus`/`QueryBus` (`libs/core`) wraps every dispatch in a `command.<Name>` /
  `query.<Name>` span. This is where a slow request is attributed to a **specific handler**
  instead of "the whole HTTP call". Records exceptions + `ERROR` status on failure. Deliberately
  **not** added to HTTP/DB/redis (already auto-instrumented — would double-span); a cheap no-op
  when tracing is off (the OTel API's default no-op tracer).
- Graceful shutdown on `SIGTERM`/`SIGINT`.

### Sampling strategy per environment

Head sampling (the ratio above) decides **before** a request is known to be slow or failing, so a
low ratio silently drops the traces you most want. Keep a low head ratio in prod and recover the
interesting traces with **tail sampling in the OTel Collector**, which decides after seeing the whole
trace:

| Env         | `OTEL_TRACES_SAMPLER_RATIO` | Collector tail sampling        |
| ----------- | --------------------------- | ------------------------------ |
| development | `1` (all)                   | none                           |
| staging     | `0.25`–`0.5`                | optional                       |
| production  | `0.01`–`0.1` (head)         | keep 100% of error/slow traces |

```yaml
# otel-collector: keep every error + slow trace, sample the rest
processors:
  tail_sampling:
    policies:
      - { name: errors, type: status_code, status_code: { status_codes: [ERROR] } }
      - { name: slow, type: latency, latency: { threshold_ms: 1000 } }
      - { name: baseline, type: probabilistic, probabilistic: { sampling_percentage: 5 } }
```

Local stack: `docker compose -f docker/compose.yml -f docker/compose.dev.yml -f docker/compose.observability.yml up`
brings up OTel Collector + Jaeger + Prometheus + Grafana (all bound to `127.0.0.1`).

## Metrics (Prometheus)

**Source of truth is the `prom-client` pull endpoint** (`/metrics`), guarded by `MetricsIpAllowGuard`
(`METRICS_ALLOW_CIDRS`, reads `socket.remoteAddress`, fails closed) — the standard Prometheus scrape
model for Kubernetes. The OTLP metric push in `start-tracing` is **off in the API**
(`OTEL_METRICS_EXPORT_ENABLED=false`) so the same series aren't counted by two pipelines; enable it
only for worker/scheduler, which have no `/metrics` endpoint. Key series:

- `http_requests_total`, `http_request_duration_seconds` (labels: method, **route template**,
  status_code — the route is `routeOptions.url` (`/api/v1/users/:id`), never the raw path, so
  label cardinality stays bounded)
- `bullmq_jobs_total`, `bullmq_job_duration_seconds`, `bullmq_queue_depth`
- `outbox_lag_seconds` — age of the oldest unprocessed outbox event
- `cqrs_commands_total`, `cqrs_queries_total` (labels: name, status), `cqrs_duration_seconds` —
  per-use-case RED metrics recorded by the traced bus above (present only when `ENABLE_METRICS=true`)

**Global-state metrics are single-writer.** `bullmq_*`, `bullmq_queue_depth`, and `outbox_lag_seconds`
describe one shared truth in Redis/Postgres that every API replica observes (the QueueEvents stream is
a broadcast). Recording them on every replica would inflate counters by the replica count and set each
gauge N times to the same value. `MetricsLeaderService` (Redis lease, `SET NX PX` + compare-and-extend)
elects one collector leader; only the leader records these series. Consequence for PromQL: because
there is a single writer, aggregate normally — `sum by (queue, status) (rate(bullmq_jobs_total[5m]))`
for counters, `max by (queue, state) (bullmq_queue_depth)` for the depth gauge. Per-replica series
(`http_*`, `cqrs_*`) are genuinely local — `sum` across replicas for those.

> **Never label a metric with `requestId`/`userId`/raw path** — unbounded cardinality melts
> Prometheus. Those identifiers belong in logs and traces, not metric labels.

Alert rules ship in `docker/prometheus/alert_rules.yml`; dashboards in
`docker/grafana/provisioning/dashboards/`.

## Health

Split for Kubernetes (`apps/api/.../health.controller.ts`):

- `GET /api/v1/health/live` — **liveness probe**. Process only, no dependencies. A failure here
  restarts the pod, so it must never depend on anything external.
- `GET /api/v1/health/ready` — **readiness probe**. Only what this pod needs to serve core traffic:
  DB primary + Redis (cache & queue). Deliberately **excludes** replica lag, queue depth, and
  pgbouncer.
- `GET /api/v1/health/dependencies` — **deep check for dashboards/alerting, NOT a probe**: BullMQ +
  pgbouncer + replication lag.
- `GET /api/v1/health` — full dependency check (DB + memory + Redis cache & queue).

> **Why the deep dependencies are off the readiness probe.** Every replica shares the same
> Postgres/Redis, so a shared-dependency blip (a 2 s replica-lag spike, a queue Redis reconnect)
> would flip **all** pods to NotReady at the same instant — Kubernetes then pulls every pod from the
> Service and you get a correlated, cluster-wide outage even though the app is perfectly able to
> serve. Readiness must answer only "can _this_ pod serve its core traffic?"; "is the wider system
> healthy?" is an alerting question, answered by `/health/dependencies`. Give the readiness probe a
> `failureThreshold` (e.g. 3) so a single slow check doesn't flap the pod out of rotation.

## Privacy & retention

Logs and traces carry personal data and cost money to store — both need an explicit policy, not
unbounded accumulation.

- **PII in logs**: `userId` (opaque UUID) and `req.remoteAddress` (an IP — personal data under GDPR)
  appear on request-scoped lines. Keep `userId` an **opaque id only** — never log email/username at
  top level (explicit-DTO mapping already keeps them out of response bodies; keep them out of logs
  too). Both fall in scope for DSAR/erasure, so they must live under a bounded retention window.
- **Retention** (set at the backend, the app does not enforce it): logs 14–30 days; traces ~7 days
  with error/slow traces kept longer via the Collector tail-sampling policy above; metrics ~15
  months downsampled. Without a retention policy, log/trace storage grows without bound and a breach
  exposes an ever-larger history.
- **Log volume**: probe noise is already dropped (`autoLogging.ignore`). At high RPS, raise the
  prod `LOG_LEVEL` (e.g. `warn`) or sample access logs — every-request `info` logging is the usual
  cause of log explosion.
- **Redaction is a deny-list** (`SENSITIVE_REDACT_PATHS`): it only censors known paths, so a newly
  added sensitive field is logged in clear until its path is added. Audit the list when new
  request/response shapes carry secrets.

## Resilience

- **Load shedding** — `@fastify/under-pressure` replies `503` (problem+json, `Retry-After`)
  when the event loop stalls past 1 s, so a load balancer drains the instance instead of
  queueing work it can't serve.
- **Compression** — `@fastify/compress` gzips JSON/GraphQL responses over 1 KB.
- **Rate limiting** — two-tier `@fastify/rate-limit` on `/api/auth/*` (see `docs/security.md`).
