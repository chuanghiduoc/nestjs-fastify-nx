# Observability guide — enable, explore, extend

Practical how-to for the three signals (logs, traces, metrics) and the alerting/dashboard stack.
For the design rationale (why ParentBased sampling, why single-writer metrics, why the health split),
read [`observability.md`](./observability.md) first — this file is the operational companion.

## 1. Enable the local stack

Observability is **opt-in**. Two env flags gate it; both default off.

```bash
OTEL_ENABLED=true                                   # boots the OpenTelemetry SDK (traces)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
ENABLE_METRICS=true                                 # exposes /metrics for Prometheus
METRICS_ALLOW_CIDRS=172.16.0.0/12                   # let the Prometheus container scrape /metrics
```

Bring the whole stack up (app + OTel Collector + Jaeger + Prometheus + Grafana), all UIs bound to
`127.0.0.1` only:

```bash
./scripts/build-dev.sh --with-obs
```

UIs (SSH-tunnel them on a remote host):

| UI         | URL                    | Notes                         |
| ---------- | ---------------------- | ----------------------------- |
| Jaeger     | http://localhost:16686 | traces                        |
| Prometheus | http://localhost:9090  | metrics + `/alerts` for rules |
| Grafana    | http://localhost:3001  | dashboards (admin / admin)    |

> Metric export is a **separate** flag from tracing. `OTEL_METRICS_EXPORT_ENABLED` pushes OTLP
> metrics and must stay **off in the API** (prom-client `/metrics` is the source of truth — two
> pipelines double-count). Turn it on only for worker/scheduler, which have no scrape endpoint.

## 2. Explore

- **Trace → logs**: every log line carries `trace_id`/`span_id` (OTel pino instrumentation) plus
  `requestId`/`correlationId`/`userId` (CLS mixin). Copy a `trace_id` from a log and paste it into
  Jaeger's "Lookup by Trace ID".
- **Search → span**: in Jaeger pick the service (`nestjs-fastify-api` / `-worker` / `-scheduler`),
  "Find Traces", open one to see the HTTP → CQRS → `pg.query` / `ioredis` span tree.
- **Metrics**: Prometheus → Graph → e.g. `sum by (route) (rate(http_requests_total[5m]))`. Alert
  rules and their state live under `/alerts`.
- **Dashboards**: Grafana ships **API Overview** (request rate by status, p99 latency per route,
  5xx ratio, outbox lag) and **Queue Health**, both provisioned from
  `docker/grafana/provisioning/`.

## 3. Add a metric

All series live on `MetricsService` (`apps/api/src/common/metrics/metrics.service.ts`). Register the
collector once and record from where the event happens.

```ts
// metrics.service.ts — declare the series
readonly widgetsBuilt = new Counter({
  name: 'widgets_built_total',
  help: 'Widgets built by outcome',
  labelNames: ['outcome'] as const, // NEVER requestId/userId/raw path — unbounded cardinality
  registers: [this.registry],
});
```

```ts
// where the work happens
this.metrics.widgetsBuilt.inc({ outcome: 'ok' });
```

**Label rules**: bounded values only. HTTP `route` uses the **route template** (`/users/:id`), never
the raw path (`http-metrics.hook.ts`). Put high-cardinality identifiers in logs/traces, not labels.

### Global-state metric → gate on the leader

If the metric describes one shared truth read from Redis/Postgres, or is driven by a BullMQ
`QueueEvents` broadcast, every API replica would record it and inflate the value by the replica
count. Gate recording on the collector leader:

```ts
constructor(/* … */ private readonly leader: MetricsLeaderService) {}

@Interval(30_000)
async collect(): Promise<void> {
  if (!this.leader.isLeader()) return; // single writer — see queue-depth.collector.ts
  // read shared state, set the gauge
}
```

Per-replica series (`http_*`, `cqrs_*`) stay **ungated**. PromQL then aggregates normally:
`sum(rate(...))` for counters, `max by (...)` for a leader-written gauge.

## 4. Add a trace span

HTTP, Postgres, ioredis, GraphQL and socket.io are auto-instrumented — you get those spans for free.
For business logic, the CQRS bus (`libs/core`) already wraps every command/query in a
`command.<Name>` / `query.<Name>` span. To trace anything else, use the OTel API:

```ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-context');
await tracer.startActiveSpan('rebuild-index', async (span) => {
  try {
    await doWork();
  } catch (err) {
    span.recordException(err as Error);
    throw err;
  } finally {
    span.end(); // always end on every path
  }
});
```

Do **not** re-span HTTP/DB/redis (already auto-instrumented — you'd double-span).

## 5. Add a structured log field

Request-scoped fields flow through the CLS store, surfaced by the pino `mixin`
(`libs/infra/observability/src/lib/pino-logger-config.ts`) on **every** log line in the request —
handlers, repositories, listeners — not just the HTTP access log. Add a field to
`RequestContextStore` + set it in the CLS setup (`logging.module.ts`); the mixin picks it up.

**Never** log a raw client-supplied id without validation (`sanitizeClientId`, `request-id.ts`) —
newlines enable log injection. Add sensitive keys to `SENSITIVE_REDACT_PATHS`
(`libs/shared/src/lib/logger-redact.ts`); it is a **deny-list**, so a new secret field is logged in
clear until its path is added.

## 6. Add an alert rule

Edit `docker/prometheus/alert_rules.yml`, then validate before committing:

```bash
docker run --rm --entrypoint promtool \
  -v "$(pwd)/docker/prometheus/alert_rules.yml:/rules.yml:ro" \
  prom/prometheus:v3.3.0 check rules /rules.yml
```

Reload Prometheus without a restart: `curl -X POST http://localhost:9090/-/reload`
(`--web.enable-lifecycle` is already set). Wire an Alertmanager under `alerting:` to route to
Slack/PagerDuty in a real deployment.

## 7. Add / edit a Grafana dashboard

Dashboards are provisioned JSON under `docker/grafana/provisioning/dashboards/`. Edit in the Grafana
UI, export the JSON (Share → Export → Save to file), and commit it back. The `cqrs_commands_total` /
`cqrs_queries_total` / `cqrs_duration_seconds` series are exported but not yet dashboarded — a good
starting point for a per-use-case RED panel.

## 8. Verify a change end-to-end

Drive the real signal, don't just unit-test. After enabling the stack:

```bash
# metrics: route is a template, no PII labels
curl -s localhost:3000/metrics | grep -E 'http_requests_total|route='
# trace pipeline: traces reach Jaeger
curl -s 'http://localhost:16686/api/traces?service=nestjs-fastify-api&limit=1' | grep traceID
# leader lease (single-writer metrics) — redis-queue listens on 6380
docker exec <project>-redis-queue-1 redis-cli -p 6380 GET bull:metrics:collector-leader
# alert rules parse and evaluate
curl -s http://localhost:9090/api/v1/rules | grep -o '"health":"[a-z]*"'
```

## 9. Production notes

- **Sampling**: keep a low head ratio (`OTEL_TRACES_SAMPLER_RATIO`, e.g. `0.05`) and let the
  Collector's `tail_sampling` keep 100% of error/slow traces (`docker/otel-collector/config.yaml`).
  ParentBased is already wired, so child spans honor the parent's decision.
- **Edge trust**: keep `OTEL_TRUST_INBOUND_TRACEPARENT=false` on a public edge so clients can't
  inject or collide trace ids; set `true` only behind a trusted mesh/gateway.
- **Retention & PII**: `userId`/IP appear in logs (personal data). Set retention at the backend
  (logs 14–30d, traces ~7d + error traces longer, metrics ~15mo) — the app does not enforce it.
- **Health probes**: point Kubernetes readiness/liveness at `/health/ready` and `/health/live`
  **only**. `/health/dependencies` is a deep check for dashboards/alerting — never a probe, or a
  shared-dependency blip flips every replica to NotReady at once.
