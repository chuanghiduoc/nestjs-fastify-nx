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

### Nx marks a build/typecheck "flaky", or `tsc` errors with TS6305 / EPERM

Symptom: `nx affected` succeeds but prints "Nx detected a flaky task", or an occasional
`TS6305: Output file ... has not been built` / `EPERM: permission denied, ...\.nx\...`.

Cause: on Windows, the Nx daemon and Windows Defender hold short-lived locks on `.nx/` and
`dist/out-tsc/` while parallel `tsc --build` / webpack tasks read and write there. A lock
contention makes one task fail transiently; Nx then remembers the task as flaky until reset.
It is an environment race, not a code error — the same task passes on the next run.

Resolution:

```bash
pnpm nx daemon --stop   # release daemon file locks
pnpm nx reset           # clear the cache + flaky task history
pnpm nx affected -t lint typecheck test build --base=origin/main
```

Prevention: exclude the workspace folder from Windows Defender real-time scanning
(Settings → Virus & threat protection → Exclusions), which removes the main source of the
lock contention. CI on Linux runners does not hit this.

### `pnpm codegen` crashes with `js-yaml does not provide an export named 'default'`

Symptom: `pnpm codegen` (orval) aborts before generating the client:

```
SyntaxError: The requested module 'js-yaml' does not provide an export named 'default'
```

Cause: orval's ESM config bundle does `import yaml from "js-yaml"` (a default import).
`js-yaml@5` is pure ESM and dropped the default export, so the import fails. The `js-yaml`
version is controlled by the `pnpm.overrides` entry in `package.json`. When that override was
`">=4.2.0"` it floated up to `js-yaml@5` on any lockfile regeneration (e.g. a Dependabot bump),
silently breaking codegen — the orval version was a red herring, every orval release broke
once js-yaml floated to v5.

Resolution: keep the override capped at v4 — `"js-yaml": "^4.2.0"`. It stays there until orval
switches to a named `js-yaml` import; there is no reason to relax it.

### Dependabot proposes `typescript` 7.x (major) — why it is ignored

The `typescript` npm package is intentionally pinned to `^6.0.x`. Typecheck and build already
run the faster TS 7 native compiler through the separate `@typescript/native` package, but the
`typescript` package itself feeds tools that bind to the **TS 6** Compiler API:
`typescript-eslint`, `orval`, and `vite`. Bumping `typescript` to 7.0.x crashes eslint across
every project with `Cannot read properties of undefined (reading 'Ts')` /
`(reading 'Intrinsic')`. The bump is blocked in `.github/dependabot.yml`
(`dependency-name: typescript`, `version-update:semver-major`).

Why each tool blocks (verified 2026-07-13):

- **typescript-eslint** — the sole hard blocker. 8.63.0 pins `peerDependencies.typescript`
  to `>=4.8.4 <6.1.0`; forcing TS 7 crashes `@typescript-eslint/typescript-estree`. Tracking
  issue: [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940).
- **orval** — already fine (8.20.0+ handles the TS 6 side-by-side alias); it only needs a
  TS 6 Compiler API to remain available.
- **vite** — unaffected; 8.x has no `typescript` dependency at all (it transpiles via esbuild).

There is a deeper reason this can't move yet: **TypeScript 7.0 ships without a programmatic
Compiler API** — a stable API is only expected in **TypeScript 7.1**. So even the tools want
to wait.

When to un-ignore: remove the `typescript` ignore entry once **both** hold — (1) TypeScript 7.1
ships the stable Compiler API, and (2) `typescript-eslint` publishes a release whose
`typescript` peer range includes `7.x`. Quick check:

```bash
npm view typescript-eslint peerDependencies.typescript   # must include 7.x
```

Also see [typescript-eslint dependency-versions](https://typescript-eslint.io/users/dependency-versions/).
Bump `typescript-eslint` first, then drop the ignore so Dependabot re-proposes TS 7.

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

## PgBouncer (connection pooler)

### `prepared statement "..." does not exist`

Symptom: Prisma queries fail with `ERROR: prepared statement "s0" does not exist`
when routed through pgbouncer.

Cause: pgbouncer is running in transaction mode without prepared-statement
tracking. In transaction mode each statement may execute on a different server
connection, so a statement prepared on connection A is not visible on connection B.

Resolution:

1. Verify you are running `edoburu/pgbouncer:1.23.1` or newer (≥ 1.21 required).
2. Confirm `max_prepared_statements = 200` is set in `pgbouncer.ini`
   (or `MAX_PREPARED_STATEMENTS=200` in the compose service env).
3. Restart the pgbouncer container — the setting is only read at startup.

### SCRAM hash mismatch — pgbouncer cannot authenticate to Postgres

Symptom: pgbouncer logs `wrong password` or `SASL authentication failed` at
startup, and all client connections immediately fail.

Cause: `userlist.txt` was generated with the wrong password, or the password
changed in Postgres without regenerating the hash.

Resolution:

1. Check `docker logs <pgbouncer-container>` for the hash-generation step.
   `edoburu/pgbouncer` logs `Generating SCRAM-SHA-256 hash` at startup.
2. If the password changed in Postgres, destroy and recreate the pgbouncer
   container so the startup script regenerates `userlist.txt`.
3. In production (Docker secrets pattern), verify the secret was created with
   the correct password: `docker secret inspect postgres_password` (shows
   metadata, not the value — recreate if in doubt).

### Migration container hangs or `prisma migrate deploy` fails through pooler

Symptom: the migration container exits with `prepared statement` errors or
hangs indefinitely at startup.

Cause: the migration container is connecting through pgbouncer. Prisma migrate
uses session-scoped DDL operations (advisory locks, `SET LOCAL`) that are
incompatible with transaction mode.

Resolution: set `DATABASE_DIRECT_URL` so the migration bootstrap
(`apps/migration/src/main.ts`) re-exports `DATABASE_URL` to the direct Postgres
address before invoking `prisma migrate deploy`. When using the compose overlay
this is already set — verify with:

```bash
docker compose config | grep -A5 'migration:'
# Should show DATABASE_DIRECT_URL pointing at postgres:5432, not pgbouncer:6432
```

### `/health/ready` returns 503 — pgbouncer probe failing

Symptom: `GET /api/v1/health/ready` returns 503 with `pgbouncer: { status: 'down' }`.

Cause: pgbouncer is unreachable on `DATABASE_URL`. The `PgBouncerHealthIndicator`
opens an ephemeral pg Client to the pooler endpoint and reports unhealthy on any
connection error or 2-second timeout.

Resolution:

1. `docker compose ps pgbouncer` — confirm the container is healthy.
2. Check pgbouncer logs: `docker logs <pgbouncer-container> --tail 50`.
3. Confirm `DATABASE_URL` in the api service env points at `pgbouncer:6432`,
   not `postgres:5432`.
4. Confirm `DATABASE_DIRECT_URL` is also set — the indicator is a no-op when
   it is absent (returns `skipped`), so if you see `down` the env var is set.

### `remaining connection slots reserved for replication`

Symptom: pgbouncer logs `ERROR: remaining connection slots are reserved for
non-replication superuser connections` when acquiring a server connection.

Cause: `default_pool_size` (or `reserve_pool_size`) combined with pgbouncer's
admin connections are pushing total connections above Postgres `max_connections`.

Resolution:

1. Raise Postgres `max_connections` (restart required), or
2. Lower `PGBOUNCER_POOL_SIZE` so total server connections fit within
   `max_connections - 5` (leave headroom for superuser admin access), or
3. Lower `DATABASE_POOL_MAX` on the app side to reduce the required pool size.

## HA pgbouncer (2× + HAProxy)

These failure modes apply only when using the `examples/pgbouncer-ha/` overlay.

### HAProxy reports "no available backends"

Symptom: all app queries fail with connection refused or timeout; HAProxy logs
`backend pgbouncers has no server available`.

Cause: both pgbouncer instances failed their healthchecks simultaneously.

Diagnostic:

```bash
docker compose logs pgbouncer-1 pgbouncer-2 --tail 50
docker compose ps pgbouncer-1 pgbouncer-2
```

Common sub-causes:

- Both pgbouncer containers are unhealthy (SCRAM hash mismatch, Postgres down).
  Resolve the underlying pgbouncer issue; HAProxy will re-admit backends once
  `rise=2` consecutive healthchecks pass.
- The `healthcheck_user` role is missing from Postgres. HAProxy's `pgsql-check`
  fails authentication for both backends. Create the role (see
  `examples/pgbouncer-ha/README.md`) or temporarily remove `option pgsql-check`
  to fall back to plain TCP checks.
- HAProxy config file is invalid. Run `docker compose exec haproxy haproxy -c -f
/usr/local/etc/haproxy/haproxy.cfg` to validate.

### Split-brain after Postgres failover

Symptom: after a Postgres primary failover (Patroni promotion, RDS failover),
queries succeed on some app replicas and fail on others.

Cause: HAProxy routes traffic to whichever pgbouncer instances are healthy by
TCP. Neither HAProxy nor pgbouncer tracks the Postgres primary endpoint
automatically — both still point at the old `DB_HOST`.

Resolution:

1. Update `DB_HOST` (or `DATABASE_URL`) to the new Postgres primary address.
2. Restart pgbouncer-1 and pgbouncer-2 so they reconnect to the new primary:
   ```bash
   docker compose restart pgbouncer-1 pgbouncer-2
   ```
3. Verify with `docker compose logs pgbouncer-1 pgbouncer-2` — look for
   successful backend connections.

For automated failover, use a managed pooler (Option D — RDS Proxy, Supavisor)
that integrates with the underlying Postgres HA mechanism, or add a Patroni-aware
sidecar that rotates `DB_HOST` and issues a `RELOAD` to pgbouncer via its admin
console (`PGPASSWORD=... psql -h localhost -p 6432 -U pgbouncer pgbouncer -c RELOAD`).

### Healthcheck flapping (backends oscillate between UP and DOWN)

Symptom: HAProxy logs alternate between `Server pgbouncers/pgb1 is UP` and
`Server pgbouncers/pgb1 is DOWN` within seconds; app sees intermittent errors.

Cause: the `inter=2s` probe interval or `rise`/`fall` thresholds are too
aggressive for the cluster's startup or network latency.

Resolution: increase `inter`, raise `rise`, or lower `fall` in `haproxy.cfg`:

```haproxy
# Less sensitive — marks DOWN after 5 failures, UP after 3 successes
server pgb1 pgbouncer-1:6432 check inter 3s rise 3 fall 5
server pgb2 pgbouncer-2:6432 check inter 3s rise 3 fall 5
```

Rebuild haproxy after editing the config:

```bash
docker compose up -d --force-recreate haproxy
```

Also add `start_period` to the pgbouncer healthcheck in the compose overlay if
containers are slow to initialize (the SCRAM hash-generation step takes ~1 s on
first boot).

### Stale connection surge after failover

Symptom: immediately after pgbouncer-1 recovers and HAProxy re-admits it, the
app sees a brief spike in connection-setup latency and a `connection reset`
error rate.

Cause: expected behaviour. HAProxy closes existing server-side connections to a
backend when it is marked DOWN. Prisma's connection pool re-establishes on the
next query. The surge lasts for one pool-fill cycle (~`DATABASE_POOL_MAX ×
connect_timeout` ms) and self-resolves.

No action required. If the surge causes unacceptable latency spikes, pre-warm
the pool after restart by sending a low-cost query (e.g. `SELECT 1`) from a
readiness probe before routing real traffic.

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

## Inspecting slow queries

Requires `pg_stat_statements` to be loaded. For self-hosted Postgres, apply the
opt-in compose overlay at `examples/postgres-with-stats/` (one restart needed).
For managed Postgres (RDS, Cloud SQL, Supabase, Neon), the extension is usually
pre-enabled; run `SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements'`
to confirm, then the queries below work immediately.

**Note:** inspecting `pg_stat_statements` requires `pg_read_all_stats` role
membership (or superuser) on the connecting account. Grant it to your ops user:

```sql
GRANT pg_read_all_stats TO <your_ops_user>;
```

### Top 10 slowest by total execution time

Identifies the queries consuming the most cumulative DB time — the best
candidates for indexing or read-replica offload.

```sql
SELECT
  substring(query, 1, 120) AS query_snippet,
  calls,
  round(total_exec_time::numeric, 2)  AS total_ms,
  round(mean_exec_time::numeric, 2)   AS mean_ms,
  rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

### Top 10 by mean execution time (rare-but-slow queries)

Catches outlier queries that run infrequently but take a long time each call.
Filter `calls > 100` to exclude queries that have only run once or twice and
whose high mean is statistical noise.

```sql
SELECT
  substring(query, 1, 120) AS query_snippet,
  calls,
  round(total_exec_time::numeric, 2)  AS total_ms,
  round(mean_exec_time::numeric, 2)   AS mean_ms,
  rows
FROM pg_stat_statements
WHERE calls > 100
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Reset stats after a deploy

Clear accumulated stats to get a clean baseline for a new code version:

```sql
SELECT pg_stat_statements_reset();
```

### Slow query log entries

The compose overlay sets `log_min_duration_statement = 500` — any query over
500 ms appears in the Postgres container log as a `duration: N ms` line. Filter
with:

```bash
docker compose logs postgres | grep "duration:"
```

Adjust the threshold in the overlay YAML (`log_min_duration_statement=<ms>`) if
you need to catch faster queries during a load test, then restore to 500 after.
