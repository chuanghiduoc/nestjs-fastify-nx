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
# Production images — api/worker/scheduler share the root Dockerfile so the
# `workspace` stage (install + source + prisma generate + nx sync) is built
# once and reused. Migration uses its own Dockerfile (--prod install only).
docker build -f Dockerfile --target api       -t your-registry/nestjs-api:latest .
docker build -f Dockerfile --target worker    -t your-registry/nestjs-worker:latest .
docker build -f Dockerfile --target scheduler -t your-registry/nestjs-scheduler:latest .
docker build -f apps/migration/Dockerfile     -t your-registry/nestjs-migration:latest .
```

For all four in one shot (BuildKit shares stages across siblings):

```bash
./scripts/build-prod.sh                       # gated by Trivy on local
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
   - Migrates the database and triggers Coolify deploy only after every gate
     passes.

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

- **API**: Stateless — scale horizontally behind a load balancer. Sessions are stored in Postgres via Better Auth, so any instance can validate the `better-auth.session_token` cookie.
- **Worker**: Scale horizontally — BullMQ distributes jobs across all worker instances automatically.
- **Scheduler**: Run as a **single instance** only. Multiple scheduler instances will duplicate cron jobs.
