# pg_stat_statements + slow query log overlay

Opt-in compose overlay that enables `pg_stat_statements` and slow-query logging
on the local Postgres container. Use this to identify which queries are slow
before making read-replica or index decisions.

## What this overlay does

- Loads `pg_stat_statements` via `shared_preload_libraries` — tracks every query
  executed, its call count, cumulative time, mean time, and I/O time.
- Sets `pg_stat_statements.max = 10000` — keeps the 10 000 most distinct query
  fingerprints in shared memory.
- Sets `pg_stat_statements.track = all` — tracks queries from all users and all
  nested function bodies.
- Sets `track_io_timing = on` — adds per-query I/O read/write times to the view
  (useful when distinguishing CPU-bound from I/O-bound queries).
- Sets `log_min_duration_statement = 500` — logs any query that takes longer
  than 500 ms to the Postgres log stream. Bounded volume: only true outliers
  are logged.

## How to enable

```bash
# Dev:
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.dev.yml \
  -f examples/postgres-with-stats/compose.postgres-stats.yml \
  up -d postgres

# Prod (same pattern, swap compose.dev.yml → compose.prod.yml):
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.prod.yml \
  -f examples/postgres-with-stats/compose.postgres-stats.yml \
  up -d postgres
```

`shared_preload_libraries` is a startup parameter — Postgres must (re)start with
the overlay flags to load the library. The base `compose.yml` is a fragment
(api/worker/scheduler/migration have no `image` or `build` directive), so
`compose.dev.yml` or `compose.prod.yml` must be layered in before this overlay.
If the container was already running, `up -d postgres` restarts only the
`postgres` service automatically.

## Verification

Connect to Postgres and confirm the extension is registered:

```bash
docker compose exec postgres psql -U postgres -d app -c '\dx pg_stat_statements'
```

Expected output:

```
                          List of installed extensions
       Name        | Version | Schema |             Description
-------------------+---------+--------+-------------------------------------
 pg_stat_statements | 1.10   | public | track planning and execution...
```

After running some queries through the app, confirm stats are collecting:

```sql
SELECT count(*) FROM pg_stat_statements;
-- should return > 0
```

## Inspection queries

See `docs/troubleshooting.md` → "Inspecting slow queries" for the full set of
inspection SQL statements, including top-N by total time, top-N by mean time,
and slow query log filtering.

## Reset stats after a deploy

```sql
SELECT pg_stat_statements_reset();
```

Run this after deploying a new version so you get a clean baseline for the new
code. Stats from old query shapes do not carry over.

## Managed Postgres (RDS / Cloud SQL / Supabase / Neon / AlloyDB)

Skip this overlay entirely. Managed providers typically have
`pg_stat_statements` pre-enabled via their platform configuration. The
migration in this repo (`prisma/migrations/20260601100000_pg_stat_statements/`)
runs `CREATE EXTENSION IF NOT EXISTS pg_stat_statements` which registers the
extension in your database automatically when the library is already loaded.

You can verify with:

```sql
SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';
```

If the extension is already registered, the migration is a no-op and you can
proceed directly to the inspection queries.

## Overhead

`pg_stat_statements` adds approximately 3–5 % per-query overhead at worst-case
QPS in benchmarks. This is the production-standard tradeoff for the
observability win. Adjust `pg_stat_statements.max` downward (e.g. `1000`) if
you observe memory pressure on shared memory (`pg_shmem_allocations`).
