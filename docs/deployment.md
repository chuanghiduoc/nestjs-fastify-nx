# Deployment

## Prerequisites

- Docker 24+ and Docker Compose v2
- Access to a container registry (GHCR, ECR, Docker Hub)
- PostgreSQL 18 and Redis 8 in production
- MinIO or S3-compatible storage

## Environment Variables

Copy `.env.example` and fill in production values. See [Environment Variables](environment.md) for the full reference.

Critical variables for production:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_CACHE_HOST=redis-cache-host
REDIS_QUEUE_HOST=redis-queue-host
BETTER_AUTH_SECRET=<min-32-char-random-string>
NODE_ENV=production
CORS_ORIGINS=https://your-frontend.com
```

## Building Images

Images are built automatically by the [release workflow](../.github/workflows/release.yml) on `v*.*.*` tags.

To build manually:

```bash
# Production images — all four apps share the root Dockerfile so BuildKit
# reuses the `workspace` stage (install + source + prisma generate + nx sync)
# across every image — one install round-trip instead of two.
docker build -f Dockerfile --target api       -t your-registry/nestjs-api:latest .
docker build -f Dockerfile --target worker    -t your-registry/nestjs-worker:latest .
docker build -f Dockerfile --target scheduler -t your-registry/nestjs-scheduler:latest .
docker build -f Dockerfile --target migration -t your-registry/nestjs-migration:latest .
```

For all four in one shot (BuildKit shares stages across siblings):

```bash
./scripts/build-prod.sh                       # build + boot only; Trivy/SBOM/sign live in CI (release.yml)
```

## Database Migrations

Run migrations **before** starting the API:

```bash
docker run --rm \
  -e DATABASE_URL=postgresql://... \
  your-registry/nestjs-migration:latest
```

The migration image only seeds the admin user when `RUN_SEED=true` is
set; routine schema deploys leave user data untouched. Pass
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` only when explicitly opting
in:

```bash
docker run --rm \
  -e DATABASE_URL=postgresql://... \
  -e RUN_SEED=true \
  -e SEED_ADMIN_EMAIL=admin@example.com \
  -e SEED_ADMIN_PASSWORD=<strong-password> \
  your-registry/nestjs-migration:latest
```

## Docker Compose (Production)

```bash
# Copy and configure
cp .env.example .env
# Edit .env with production values, including IMAGE_NAMESPACE and IMAGE_TAG

# Start infrastructure + apps
docker compose --env-file .env -f docker/compose.yml -f docker/compose.prod.yml up -d
```

The base `compose.yml` defines the infrastructure services (PostgreSQL, Redis,
MinIO) and healthcheck specs for worker/scheduler. The
`compose.prod.yml` overlay pins each app to a published image
(`${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/<app>:${IMAGE_TAG}`), enforces a single
scheduler replica, and excludes mailpit via the `dev-only` profile.

## Network Exposure & Port Binding

The base `compose.yml` publishes host ports for Postgres, Redis, and MinIO as a
**dev convenience**. Short-form mappings (`5432:5432`) bind `0.0.0.0` _through
Docker's own iptables chain, which bypasses `ufw`/`firewalld`_ — on a public-IP
host they are internet-reachable even behind a "deny" rule. The
`compose.prod.yml` overlay closes this:

| Service                                      | Host port in prod overlay                                     | Reachable by                                                                    |
| -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| postgres / redis-cache / redis-queue / minio | none — stripped via `ports: !override []`                     | other containers only, by service name (`postgres:5432`, `redis-cache:6379`, …) |
| api                                          | `${API_BIND_HOST:-127.0.0.1}:${API_PORT:-3000}:${PORT:-3000}` | loopback only by default — **not** the public internet                          |

### Exposing the api

Loopback (`127.0.0.1`) by default, so the api is never internet-facing out of
the box. This image is deploy-agnostic — pick whichever fits, nothing else changes:

- **TLS proxy on the host** (nginx/Caddy/…) → `proxy_pass http://127.0.0.1:${API_PORT}`.
- **Proxy or tunnel container on the compose network** → reaches `api:${PORT}` by
  Docker DNS, ignoring the host bind. A `cloudflared`/Tailscale sidecar needs no
  published host port at all — drop `ports:` on the api service entirely.
- **Direct exposure** (managed L4 LB, or none) → set `API_BIND_HOST=0.0.0.0`.

> Docker port publishing **bypasses `ufw`/`firewalld`** — a `0.0.0.0` bind is
> internet-open even behind a host "deny" rule. Gate it with a cloud security
> group or a `DOCKER-USER` iptables rule.

> **Swarm note**: `compose.swarm.yml` publishes the api through the routing mesh
> (`ports: !override` with `mode: ingress`) and strips the data-tier ports the
> same way, so the swarm path is unaffected by `API_BIND_HOST`.

See also `TRUST_PROXY_HOPS` under [Scaling](#scaling) — set it to the number of
proxy hops so Fastify resolves `req.ip` from `X-Forwarded-For` correctly.

## Local Observability Stack (opt-in)

The `docker/compose.observability.yml` overlay starts Prometheus, Grafana, Jaeger, and an OTel collector alongside the dev stack. It is intentionally excluded from the base compose files to keep the default stack lightweight.

```bash
# Start dev stack + observability
./scripts/build-dev.sh --with-obs

# Or manually
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.dev.yml \
  -f docker/compose.observability.yml \
  up -d
```

Enable instrumentation in `.env`:

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
ENABLE_METRICS=true
# Allow the Prometheus container (Docker bridge) to scrape /metrics
METRICS_ALLOW_CIDRS=172.0.0.0/8
```

| Service    | URL                    | Notes                 |
| ---------- | ---------------------- | --------------------- |
| Grafana    | http://localhost:3001  | admin / admin         |
| Jaeger UI  | http://localhost:16686 | Trace explorer        |
| Prometheus | http://localhost:9090  | Metrics scrape target |
| OTel gRPC  | localhost:4317         | OTLP receiver         |
| OTel HTTP  | localhost:4318         | OTLP receiver         |

Config files live under `docker/prometheus/`, `docker/otel-collector/`, and `docker/grafana/provisioning/`. The observability stack is for local development and demos — production observability should use a managed service or a dedicated cluster.

The overlay binds every port to `127.0.0.1` only, so none of these UIs are reachable from the internet even on a public host — reach them with an SSH tunnel (see below).

### Viewing logs & errors on a headless server

A container logs structured JSON to stdout — never to a file inside the container. Docker captures it via the `json-file` driver (rotated `50m × 5` in `compose.prod.yml`). On a server without a desktop, everything below runs in the SSH terminal — no browser needed.

```bash
# Tail one app's logs (JSON, one line per request)
docker compose -f docker/compose.yml -f docker/compose.prod.yml logs -f api

# Trace a single request end-to-end by its id (echoed in the RFC 9457 error body)
docker compose -f docker/compose.yml -f docker/compose.prod.yml logs api | grep 'req-019732db'

# Pretty-print while reading
docker compose -f docker/compose.yml -f docker/compose.prod.yml logs api | npx pino-pretty
```

Typical failure-triage flow:

1. The API error response carries `requestId` (RFC 9457 problem+json) — the user reports it.
2. `grep` that id in `docker compose ... logs` to see the full ordered log chain for the request.
3. Open **Sentry** and filter by the `requestId` tag for the exact stack trace and breadcrumbs.
4. If it is slow rather than broken, copy the `trace_id` from the log line (present once `OTEL_ENABLED=true`) into **Jaeger** to find the offending span.

To open Jaeger/Grafana/Prometheus that run on the remote host, do **not** expose them publicly. Tunnel them to your workstation over SSH:

```bash
# Run on your workstation, then open http://localhost:16686 etc. locally
ssh -L 16686:localhost:16686 -L 3001:localhost:3001 -L 9090:localhost:9090 user@your-server
```

For a team that needs persistent access, put the host on a private network (VPN / Tailscale) or use a managed backend (Grafana Cloud, Sentry SaaS, Datadog). Only expose a dashboard publicly behind TLS **and** authentication, ideally behind a VPN — never a raw public port.

## Release Process

1. Merge to `main`
2. Tag the release: `git tag v1.2.3 && git push origin v1.2.3`
3. The [release workflow](../.github/workflows/release.yml) automatically:
   - Builds all 4 images (api, worker, scheduler, migration) with SBOM +
     max-mode SLSA provenance attestations.
   - Pushes to GHCR (`ghcr.io/<owner>/<repo>`).
   - Signs each image with **Cosign keyless** (Sigstore Fulcio) — identity is
     the workflow ref, recorded in the public Rekor log.
   - Gates on **Trivy** image scan (HIGH/CRITICAL, fixable only) and
     **Semgrep** SAST (TS/Node/OWASP rule packs).
4. Roll out from your target environment: pull the published tag from GHCR, run
   the migration image against the prod database, then start/restart the
   services. This step is deployment-specific and intentionally left out of CI.

See [docs/security.md](./security.md) for the full scanner inventory and how
to verify a signed tag locally with `cosign verify`.

## Health Checks

| Endpoint                   | Description                           |
| -------------------------- | ------------------------------------- |
| `GET /api/v1/health`       | Full check: DB + memory + Redis       |
| `GET /api/v1/health/ready` | Readiness: DB connectivity only       |
| `GET /api/v1/health/live`  | Liveness: always 200 if process is up |

Worker and scheduler use file-based liveness probes (`/tmp/worker-alive`, `/tmp/scheduler-alive`), refreshed every 30 seconds.

## Scaling

| Env var                     | Default | Effect                                                                                                                        |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `API_REPLICAS`              | `1`     | Number of api containers. Front with any L7 reverse proxy that supports keep-alive + WS upgrade (nginx, Traefik, Caddy, ALB). |
| `WORKER_REPLICAS`           | `1`     | Number of worker containers. BullMQ distributes jobs automatically across all replicas via atomic Redis locks.                |
| `WORKER_EMAIL_CONCURRENCY`  | `5`     | Per-queue parallelism inside each worker replica for email jobs. Effective throughput = concurrency × replicas.               |
| `WORKER_UPLOAD_CONCURRENCY` | `5`     | Per-queue parallelism inside each worker replica for upload-verification jobs.                                                |

Place any L7 reverse proxy in front of the api service that forwards `X-Forwarded-For` and proxies WebSocket upgrades. Set `TRUST_PROXY_HOPS` to the number of proxy hops between the edge and the api container so Fastify resolves `req.ip` correctly; the WS per-IP cap and the metrics guard both use the raw TCP socket address (`socket.conn.remoteAddress` / `socket.remoteAddress`) and are not affected by this value.

> **Important**: Throttler limits (`THROTTLER_LIMIT`, `AUTH_RATE_LIMIT_MAX`) are cluster-wide counters backed by Redis shared state — set them for **total** expected traffic, not per-replica. With `API_REPLICAS=5` and `THROTTLER_LIMIT=100`, each IP is limited to 100 req/min total, not 500.
>
> **Connection pool budget**: `(API_REPLICAS + 1) × DATABASE_POOL_MAX` must stay below your Postgres `max_connections` (typically 80–100 for a default installation). The worker contributes 0 database connections. If replicas × pool would exceed the budget, add PgBouncer in transaction mode in front of Postgres — see [Connection Pooling](#connection-pooling) below.

- **Scheduler**: Run as a **single instance** only. Multiple scheduler instances will duplicate cron jobs. The `deploy.update_config.order: stop-first` in `compose.prod.yml` ensures the old scheduler stops before the new one starts during rolling updates — a brief cron gap is preferable to a double-fire window.

## Connection Pooling

### When you need a pooler

```text
(API_REPLICAS + 1 scheduler) × DATABASE_POOL_MAX > Postgres max_connections
```

The worker contributes **zero** database connections. A default Postgres install
has `max_connections=100`. With `DATABASE_POOL_MAX=20` you hit the limit at
5 API replicas; with `DATABASE_POOL_MAX=5` you have room for 19 replicas.

### Sizing formula

```text
required_server_conns = (API_REPLICAS + 1) × DATABASE_POOL_MAX

pgbouncer default_pool_size  ≥ required_server_conns
pgbouncer reserve_pool_size   = 5   (burst buffer)

Postgres max_connections must be:
  ≥ default_pool_size + reserve_pool_size + 5  (admin headroom)
```

Example — `API_REPLICAS=10`, `DATABASE_POOL_MAX=5`:

```text
required = (10 + 1) × 5 = 55
→ set PGBOUNCER_POOL_SIZE=55, Postgres max_connections ≥ 65
```

### Option A — Direct connection (boilerplate default)

No extra service. Set only `DATABASE_URL`. Works until the formula above
exceeds `max_connections`.

### Option B — Self-hosted pgbouncer (opt-in overlay)

```bash
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.prod.yml \
  -f examples/pgbouncer/compose.pgbouncer.prod.yml \
  up -d
```

See [`examples/pgbouncer/`](../examples/pgbouncer/) for the full walkthrough,
pool-sizing guide, and Docker secrets pattern for production credentials.

Set these in `.env` when the overlay is active:

```bash
# App traffic → pooler
DATABASE_URL=postgresql://user:pass@pgbouncer:6432/nestjs_db
# Prisma CLI + migration container → direct Postgres (bypasses pooler for DDL)
DATABASE_DIRECT_URL=postgresql://user:pass@postgres:5432/nestjs_db
PGBOUNCER_POOL_SIZE=30          # server-side connections to Postgres
PGBOUNCER_MAX_CLIENT_CONN=500   # client-side cap
```

### Option C — HA pgbouncer (2× + HAProxy)

Two pgbouncer instances behind HAProxy eliminates the pooler as a SPOF.
Required for 99.9 %+ uptime SLO. See [`examples/pgbouncer-ha/`](../examples/pgbouncer-ha/) for
the full walkthrough, failover verification steps, and production secrets pattern.

```bash
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.prod.yml \
  -f examples/pgbouncer/compose.pgbouncer.prod.yml \
  -f examples/pgbouncer-ha/compose.pgbouncer-ha.yml \
  up -d
```

Set `DATABASE_URL` to route through HAProxy:

```bash
DATABASE_URL=postgresql://user:pass@haproxy:6432/nestjs_db
DATABASE_DIRECT_URL=postgresql://user:pass@postgres:5432/nestjs_db
```

> **Note**: this option addresses pooler availability, NOT Postgres availability.
> For HA Postgres use Patroni, Stolon, or a managed service (RDS Multi-AZ, Cloud SQL HA).

### Option D — Managed pooler (RDS Proxy, Supavisor, AlloyDB)

Point `DATABASE_URL` at the managed pooler endpoint and `DATABASE_DIRECT_URL`
at the direct instance endpoint. No extra compose service needed.

```bash
DATABASE_URL=postgresql://user:pass@proxy.rds.amazonaws.com:5432/nestjs_db
DATABASE_DIRECT_URL=postgresql://user:pass@db.rds.amazonaws.com:5432/nestjs_db
```

The migration container and Prisma CLI automatically use `DATABASE_DIRECT_URL`
when set — no code changes required.

### Managed Postgres providers

Providers like AWS RDS, Cloud SQL, AlloyDB, Supabase, and Neon typically pre-enable
`pg_stat_statements`. The migration at `prisma/migrations/20260601100000_pg_stat_statements/`
runs `CREATE EXTENSION IF NOT EXISTS` and handles registration automatically — no extra
ops step is required.

For self-hosted Postgres, see [`examples/postgres-with-stats/`](../examples/postgres-with-stats/)
for the opt-in compose overlay that enables `shared_preload_libraries` + slow query log.

## High-availability pooling

Choose the topology that matches your uptime SLO and operational budget:

| Topology                       | Uptime expectation | Memory cost | When to use                           |
| ------------------------------ | ------------------ | ----------- | ------------------------------------- |
| Direct to Postgres (no pooler) | ~99 %              | 0           | Single replica, dev, very low traffic |
| Single pgbouncer               | ~99.5 %            | ~50 MB      | Most production deployments           |
| 2× pgbouncer + HAProxy         | 99.9 %+            | ~150 MB     | Production with strict SLO            |
| Managed (RDS Proxy, Supavisor) | Provider SLO       | $$          | Hosted on the same cloud              |

The single pgbouncer option (`examples/pgbouncer/`) is a SPOF: if the pooler
container crashes, every API replica loses its database connection simultaneously.
The HA overlay (`examples/pgbouncer-ha/`) adds a second pgbouncer and an HAProxy
TCP load-balancer in front of both. HAProxy detects a failed backend within 4-6 s
and drains it from the rotation — apps see a brief connection reset, then
pgbouncer-2 takes over with no operator intervention.

See [`examples/pgbouncer-ha/README.md`](../examples/pgbouncer-ha/README.md) for
setup steps, failover verification, Docker secrets pattern, and guidance on
eliminating HAProxy as the remaining SPOF (app-node sidecar, cloud NLB, Keepalived).
