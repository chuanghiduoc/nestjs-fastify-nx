# Troubleshooting

Common failure modes and their resolutions. Issues are grouped by surface area;
search this page first when something breaks before opening an issue.

## Local development

### `pnpm install` fails with `EPERM` on Windows

The Prisma engine binaries are downloaded into `node_modules` and Windows
sometimes locks them while Node is still running. Stop any running `nx serve`
processes (api/worker/scheduler), then re-run install. If the error persists,
delete `node_modules\@prisma\engines` and reinstall.

### `nx sync` reports drift after every command

`nx sync` keeps `tsconfig` `references` in sync with the project graph. Drift
means a project file moved or a new dependency was added. Run
`pnpm nx sync` once and commit the resulting changes.

### Vitest cannot find tests in `libs/modules/*`

If you've recently bumped `@nx/vite`, the workspace globs in
`vitest.workspace.ts` may be out of date. Confirm the file lists
`libs/modules/*/vitest.config.{m,c,}{j,t}s` — that pattern was added in P1.8
and matches every module library.

### `cannot find module '@nestjs-fastify-nx/...'` after a fresh checkout

Run `pnpm prisma generate && pnpm nx sync`. The Prisma client is generated
into `node_modules/.prisma`, and Nx path mappings flow through `tsconfig`
references that `nx sync` regenerates from `project.json`.

### Import `@nestjs-fastify-nx/admin` not found (moved library)

Symptom: `Cannot find module '@nestjs-fastify-nx/admin'`.

Cause: admin module was moved from `libs/modules/admin` to `libs/composition/admin`.

Resolution: update your import from `@nestjs-fastify-nx/admin` to
`@nestjs-fastify-nx/composition-admin` (verify the mapping in `tsconfig.base.json`).

### Import `@nestjs-fastify-nx/upload` pointing to old path

Symptom: `Cannot find module from apps/api/src/common/upload`.

Cause: upload module moved from `apps/api/src/common/upload` to `libs/modules/upload`.

Resolution: update your import to `@nestjs-fastify-nx/modules-upload`.

## Database & migrations

### `prisma migrate deploy` aborts mid-migration

Symptom: `current transaction is aborted, commands ignored until end of
transaction block`.

Cause: a migration's SQL contains an explicit `BEGIN`/`COMMIT`. Prisma already
wraps each migration in its own transaction, so the inner transaction
conflicts. Remove the explicit transaction markers — the migration's
statements run atomically already.

### UUID migration fails on a dev database with legacy ids

Symptom: `invalid input syntax for type uuid: "<some-non-uuid-string>"` while
applying `20260428000002_uuid_pks`.

Cause: rows in `users` or `audit_logs` have ids that pre-date the UUIDv7
switch (CUID, ULID, etc.). For dev databases only, clean them out:

```sql
DELETE FROM users
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

For production rollouts, do NOT delete data — instead, run a one-off backfill
that rewrites each row's id to a UUIDv7 before applying the migration.

### Outbox migration fails with `unique violation` on `outbox_events.id`

Symptom: pre-existing CUID-format ids fail the `id::uuid` cast.

Resolution: drain the outbox before deploying. Wait until
`SELECT count(*) FROM outbox_events WHERE "processedAt" IS NULL` returns 0,
then apply the migration. The migration deletes already-processed rows whose
ids would otherwise block the type change.

### `foreign key constraint cannot be implemented`

Symptom appears mostly on dev DBs after switching between feature branches.

Cause: tables created by another branch (e.g., `sessions`, `accounts`,
`verifications` from a better-auth experiment) reference `users.id` with a
mismatched type after the UUID migration.

Resolution: drop the orphan tables on the dev DB and re-run migrate:

```sql
DROP TABLE IF EXISTS sessions, accounts, verifications CASCADE;
```

Production deployments will not hit this — the orphan tables exist only on
local DBs that have run feature-branch migrations.

## Eventing & Outbox

### Domain events hang or timeout during publish

Symptom: `Outbox interactive tx timeout after 30000ms` in logs when publishing events.

Cause: the outbox relay holds an interactive transaction while publishing all
queued events. If event listeners take too long or there are many events,
the transaction may exceed `OUTBOX_TX_TIMEOUT_MS`.

Resolution:

1. Increase `OUTBOX_TX_TIMEOUT_MS` (default 30s) — set it higher and redeploy.
2. Reduce `OUTBOX_BATCH_SIZE` to publish fewer events per transaction.
3. Audit listeners for slow operations (db queries, external API calls) — move
   them to BullMQ jobs if they block the transaction.

## BullMQ & queues

### Jobs stay in `failed` state forever

Symptom: jobs appear in the queue UI as failed and never retry.

Diagnostic: check `attemptsMade` against the job's `attempts` setting. If
`attemptsMade === attempts`, the job has exhausted its retry budget and is now
the responsibility of the dead-letter queue. Inspect the matching DLQ
(`<queue>:dlq`) for the envelope.

### Welcome email sent twice for the same user

Symptom: a user receives the welcome email twice within seconds.

Cause: the listener was invoked twice (likely a duplicate domain event or a
worker restart between enqueue and acknowledge). The producer enqueues with
`jobId: welcome-email:<eventId>` so BullMQ deduplicates by job id — the
second enqueue is a no-op.

If duplicates still slip through, check that `event.eventId` is stable across
emits (it MUST be a deterministic value — typically the same UUID for the
same business event).

### Worker container stuck in `unhealthy`

Symptom: `docker compose ps` shows the worker as unhealthy even though logs
look fine.

Cause: the file-based liveness probe (`/tmp/worker-alive`) hasn't been
refreshed in 60 seconds. The worker writes that file once per heartbeat — a
stuck event loop or a frozen Redis connection prevents the refresh.

Diagnostic: `docker exec <worker> stat /tmp/worker-alive` to see the last
modify time. If it's old, exec into the container and check Redis
connectivity (`redis-cli -h redis-queue -p 6380 ping`).

## Production deployment

### `compose.prod.yml` references resolve to `ghcr.io//api:latest`

Symptom: image pulls fail with `manifest not found` and the resolved image
name has a doubled slash.

Cause: `IMAGE_NAMESPACE` is unset. Set it in `.env` before running compose:

```bash
IMAGE_NAMESPACE=your-org/your-repo
IMAGE_TAG=1.2.3
```

The full reference is `${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/<app>:${IMAGE_TAG}`.

### Mailpit appears in production

Symptom: `compose up` brings up a `mailpit` container in production.

Cause: the prod overlay puts mailpit behind a `dev-only` profile. If it's
running, you've forced it on with `--profile dev-only`. Remove the flag.

### Multiple scheduler instances duplicate cron jobs

Symptom: scheduled jobs fire 2+ times per cron tick.

Cause: the scheduler was scaled past 1 instance. Cron fires per-process — only
one scheduler may run at a time. Enforce `replicas: 1` (already set in
`compose.prod.yml`) and never run `--scale scheduler=N` with `N > 1`.

### Health endpoint returns 503 even though the API is up

Endpoint: `GET /api/v1/health`.

The terminus check fails any of: DB connectivity, Redis cache ping, Redis
queue ping, memory limit. Hit `GET /api/v1/health/live` to confirm the
process itself is alive — that endpoint always returns 200 — then check
the failing dependency from the JSON body of `/health`.

## Observability

### Metrics endpoint returns 403 Forbidden or no data

Endpoint: `GET /api/v1/metrics`.

Cause 1: `ENABLE_METRICS=false` in the env. Set it to `true` to enable Prometheus
collection.

Cause 2 (403): `METRICS_ALLOW_CIDRS` is empty or does not include your IP.
The metrics endpoint uses `socket.remoteAddress` (not `req.ip`) to enforce
IP-based access control. If the allowlist is empty, all requests are rejected.

Resolution: set `METRICS_ALLOW_CIDRS` to include your IP range (e.g.
`127.0.0.1/32` for localhost, or `10.0.0.0/8` for a private network). Use
`socket.remoteAddress` (not `req.ip` which can be spoofed via X-Forwarded-For).

### Metrics endpoint unreachable or leaking data (see runbook)

See `docs/runbook.md` → Section 6 (Metrics endpoint issues) for ops procedures
and security hardening steps.

### OpenTelemetry traces don't reach the collector

1. Confirm `OTEL_ENABLED=true`. The SDK is bootstrapped only when this is set.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` points at the collector's HTTP port
   (usually `4318`), not the gRPC port.
3. Set `OTEL_DEBUG=true` to print SDK diagnostics to stderr — most failures
   surface as DNS or auth errors there.

### Audit logs missing for an action

`AuditLog` rows are written by `AuditLogListener`, which subscribes to
specific events. If an action you expected to be audited is missing, check
that the producing aggregate publishes an event registered in the listener's
event map (see `libs/modules/audit-log/src/application/listeners/`).
