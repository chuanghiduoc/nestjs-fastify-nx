# PgBouncer opt-in overlay

Transaction-mode connection pooler as a compose overlay. Use this when your
connection count exceeds Postgres `max_connections`:

```
(API_REPLICAS + 1 scheduler) × DATABASE_POOL_MAX > max_connections
```

The default Postgres install allows 100 connections. With `DATABASE_POOL_MAX=20`
and `API_REPLICAS=4` you need 100 server connections — already at the limit.
PgBouncer caps backend connections at `default_pool_size=30` regardless of how
many app replicas are running.

> **Note**: The worker contributes **zero** database connections and is excluded
> from both the formula above and this overlay.

## When to use each option

| Option                          | When                                           | Config                                                                                 |
| ------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Direct connection (default)     | `replicas × pool_max ≤ 80`                     | No overlay needed                                                                      |
| This overlay (single pgbouncer) | `replicas × pool_max > 80`, uptime SLO < 99.9% | This file                                                                              |
| HA pgbouncer                    | 99.9% uptime SLO required                      | `examples/pgbouncer-ha/`                                                               |
| AWS RDS Proxy                   | AWS-managed infra                              | Set `DATABASE_URL` to proxy endpoint; set `DATABASE_DIRECT_URL` to direct RDS endpoint |
| Supabase Supavisor              | Supabase-hosted                                | Same pattern as RDS Proxy                                                              |

## Quick start (dev / staging)

```bash
# 1. Copy and configure your environment
cp .env.example .env
# Edit .env — leave DATABASE_DIRECT_URL blank if starting fresh;
# the overlay sets both URLs automatically for the compose network.

# 2. Start the full stack with pgbouncer
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.dev.yml \
  -f examples/pgbouncer/compose.pgbouncer.yml \
  up -d

# 3. Verify pgbouncer is healthy
docker compose ps pgbouncer
# Expected: "healthy"

# 4. Confirm backend connection count stays bounded
docker exec -it <postgres-container> \
  psql -U postgres -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"
# Should stay ≤ 35 (default_pool_size=30 + reserve_pool_size=5)
# regardless of API_REPLICAS.
```

> **Dev convenience vs production security**: The dev overlay (`compose.pgbouncer.yml`)
> passes `DB_PASSWORD` as an environment variable, which is readable via `docker inspect`.
> This is acceptable for local development. **Never use the dev overlay in production.**

## Production deployment

Production uses Docker secrets so the plaintext password is never passed as an
environment variable or baked into an image layer.

```bash
# 1. Create the secret (once per swarm / compose project)
echo "your-strong-postgres-password" | docker secret create postgres_password -

# 2. Deploy with the production overlay
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.prod.yml \
  -f examples/pgbouncer/compose.pgbouncer.prod.yml \
  up -d
```

The `compose.pgbouncer.prod.yml` overlay:

- Mounts the secret at `/run/secrets/postgres_password`.
- Passes `DB_PASSWORD_FILE` (not `DB_PASSWORD`) to `edoburu/pgbouncer`, which
  reads and SCRAM-SHA-256 hashes it at startup — plaintext never touches disk.
- Sets `DATABASE_URL` (pooler) and `DATABASE_DIRECT_URL` (direct Postgres) on
  api, scheduler, and migration services **without** a password segment.
- Sets `DB_PASSWORD_FILE=/run/secrets/postgres_password` on the same services.
  `PrismaService` (api, scheduler, worker) and the migration bootstrap read
  the file at startup and rewrite the URL into
  `postgresql://user:<password>@host/db` before opening any connection — the
  plaintext password is never exposed via `docker inspect`, env-var dumps, or
  process listings.

## Environment variables

| Variable                    | Default   | Description                                       |
| --------------------------- | --------- | ------------------------------------------------- |
| `PGBOUNCER_POOL_SIZE`       | `30`      | Max server-side connections to Postgres           |
| `PGBOUNCER_MAX_CLIENT_CONN` | `500`     | Max simultaneous client connections to pgbouncer  |
| `DATABASE_DIRECT_URL`       | _(unset)_ | Direct Postgres URL for Prisma CLI and migrations |

Set `DATABASE_DIRECT_URL` in your `.env` when running `prisma migrate dev` locally
against a stack that is already using this overlay:

```bash
DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5432/nestjs_db
```

## Pool sizing formula

```
required_server_conns = (API_REPLICAS + 1) × DATABASE_POOL_MAX
```

`default_pool_size` must be ≥ `required_server_conns`. `reserve_pool_size=5` adds
a burst buffer on top. Keep `default_pool_size + reserve_pool_size` well below
Postgres `max_connections` (leave at least 5–10 connections for `psql` admin access
and replication slots).

Example for `API_REPLICAS=5`, `DATABASE_POOL_MAX=5`:

```
required = (5 + 1) × 5 = 30   ← fits within default_pool_size=30
```

Example for `API_REPLICAS=10`, `DATABASE_POOL_MAX=5`:

```
required = (10 + 1) × 5 = 55   ← raise PGBOUNCER_POOL_SIZE=55 or lower DATABASE_POOL_MAX
```

## Prepared statements

`max_prepared_statements=200` in `pgbouncer.ini` enables Prisma's statement cache
in transaction mode (requires PgBouncer ≥ 1.21, satisfied by `edoburu/pgbouncer:1.23.1`).

If you see `ERROR: prepared statement "..." does not exist`, verify:

1. You are running `edoburu/pgbouncer:1.23.1` or newer.
2. `max_prepared_statements` is set in the pgbouncer config.
3. You are not connecting with `?prepared_statements=false` in the connection string.

## Incompatible Postgres features (transaction mode)

The following features require a persistent server connection and **cannot be used
through a transaction-mode pooler**:

- `pg_advisory_lock` / `pg_advisory_unlock`
- `LISTEN` / `NOTIFY`
- `SET LOCAL` / `SET` (session parameters)
- Temporary tables

If any code path requires these, either connect via `DATABASE_DIRECT_URL` (bypassing
pgbouncer) or switch the specific pool entry to `pool_mode = session` in `pgbouncer.ini`.

## Validating the compose config

```bash
docker compose \
  --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.dev.yml \
  -f examples/pgbouncer/compose.pgbouncer.yml \
  config --quiet
# Must exit 0 with no output — confirms YAML is valid and all
# variable references resolve before a live deploy.
```
