# PgBouncer HA overlay (2× pgbouncer + HAProxy)

Eliminates the connection pooler as a single point of failure. Use this overlay
when your deployment requires a **99.9 %+ uptime SLO** and a single pgbouncer
crash would take down every API replica simultaneously.

For simpler setups (uptime SLO < 99.9 %) the single-instance overlay at
[`examples/pgbouncer/`](../pgbouncer/) is sufficient and cheaper to operate.

## Architecture

```text
                   ┌──────────────────────────┐
                   │   api  /  scheduler       │
                   └────────────┬─────────────┘
                                │ DATABASE_URL=postgresql://...@haproxy:6432/...
                                ▼
                   ┌──────────────────────────┐
                   │         HAProxy           │  TCP mode, leastconn
                   │    pgsql-aware healthcheck│  failover within 4-6 s
                   └──────┬───────────┬────────┘
                          │           │
               ┌──────────┘           └──────────┐
               ▼                                  ▼
  ┌────────────────────┐             ┌────────────────────┐
  │    pgbouncer-1      │             │    pgbouncer-2      │
  │  (transaction mode) │             │  (transaction mode) │
  └──────────┬─────────┘             └──────────┬─────────┘
             │                                   │
             └─────────────┬─────────────────────┘
                           ▼
                  ┌─────────────────┐
                  │    Postgres      │
                  └─────────────────┘
```

Both pgbouncer instances are **identical** (same image, same config via YAML
anchor). HAProxy distributes connections with `leastconn` and probes each
backend every 2 s. If pgbouncer-1 crashes, HAProxy stops routing to it within
4-6 s (`fall=3 × inter=2s`) and pgbouncer-2 carries all traffic. When
pgbouncer-1 recovers, HAProxy re-admits it after 2 consecutive successes
(`rise=2 × inter=2s = 4 s`). App services need no restart.

> **Scope**: this overlay addresses pooler availability, NOT Postgres
> availability. For HA Postgres use Patroni, Stolon, or a managed service
> (RDS Multi-AZ, Cloud SQL HA, Supabase). See
> [docs/deployment.md](../../docs/deployment.md) → "High-availability pooling".

## Prerequisites

### 1. Create the `healthcheck_user` Postgres role

HAProxy's `pgsql-check` issues a real authentication probe against this role.
The role needs LOGIN permission only — no table access.

```sql
CREATE ROLE healthcheck_user
  LOGIN
  PASSWORD 'unused'
  NOINHERIT
  NOCREATEDB
  NOCREATEROLE
  NOSUPERUSER;
-- No GRANT statements — the probe connects and immediately disconnects.
```

Run this once against your Postgres instance before bringing up the stack.
Without this role, HAProxy's pgsql-check fails authentication against both
backends and marks them DOWN permanently — the stack will be unable to serve
any traffic. If you cannot create the role, edit `haproxy.cfg` to remove
`option pgsql-check user healthcheck_user` so HAProxy uses a plain TCP-connect
probe instead (less robust — won't catch an authenticated-but-broken pgbouncer).

### 2. Update `DATABASE_URL`

The HA overlay routes app traffic through HAProxy, not directly through
pgbouncer. Change the host in `DATABASE_URL` from `pgbouncer` → `haproxy`:

```bash
# .env (or exported in your shell)
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@haproxy:6432/${POSTGRES_DB}
DATABASE_DIRECT_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```

`DATABASE_DIRECT_URL` continues to point at Postgres directly so the migration
container and Prisma CLI bypass the pooler for DDL operations.

## Enable

> Run all commands below from the repository root (where `docker/` and `examples/` live).

Layer all four compose files in order:

```bash
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.dev.yml \
  -f examples/pgbouncer/compose.pgbouncer.yml \
  -f examples/pgbouncer-ha/compose.pgbouncer-ha.yml \
  up -d
```

This overlay:

1. Sets `pgbouncer.deploy.replicas: 0` — a Swarm directive signalling that the
   single instance is superseded. In plain `docker compose` (non-swarm) the
   container still starts but receives no traffic because `api` and `scheduler`
   now point at `haproxy:6432`, not `pgbouncer:6432`.
2. Adds `pgbouncer-1` and `pgbouncer-2` with identical config (YAML anchor).
3. Adds `haproxy` listening on port `6432`, health-checked by config validation.
4. Overrides `DATABASE_URL` on `api` and `scheduler` to `haproxy:6432`.

### Validate compose config before deploy

```bash
docker compose --env-file .env \
  -f docker/compose.yml \
  -f docker/compose.dev.yml \
  -f examples/pgbouncer/compose.pgbouncer.yml \
  -f examples/pgbouncer-ha/compose.pgbouncer-ha.yml \
  config --quiet
# Must exit 0 — confirms YAML is valid and all variable references resolve.
```

### Confirm services are healthy

```bash
docker compose ps pgbouncer-1 pgbouncer-2 haproxy
# Expected: all three "healthy"
```

## Verify failover

```bash
# 1. Kill one pgbouncer instance
docker compose kill pgbouncer-1

# 2. App should see < 5 s downtime as HAProxy fails over to pgbouncer-2.
#    Existing idle connections are dropped; Prisma reconnects on next query.

# 3. Confirm pgbouncer-2 is carrying traffic (backend connection count rises)
docker compose exec postgres psql -U postgres -c \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'pgbouncer%';"

# 4. Restore pgbouncer-1
docker compose start pgbouncer-1
# HAProxy picks it back up within 4 s (rise=2 × inter=2s).
```

## Production hardening

### Docker secrets for credentials

In production never pass `DB_PASSWORD` as a plain environment variable —
it is visible via `docker inspect`. Use Docker secrets instead:

```bash
# Create the secret once per swarm / compose project
echo "your-strong-postgres-password" | docker secret create postgres_password -
```

Then override the pgbouncer environment in a production secrets overlay:

```yaml
# compose.pgbouncer-ha.prod.yml (create alongside this file)
secrets:
  postgres_password:
    external: true

services:
  pgbouncer-1: &pgbouncer
    secrets:
      - postgres_password
    environment:
      DB_PASSWORD_FILE: /run/secrets/postgres_password

  pgbouncer-2:
    <<: *pgbouncer
```

`edoburu/pgbouncer` reads `DB_PASSWORD_FILE` and hashes it to SCRAM-SHA-256 at
startup — the plaintext secret never touches disk or appears in `docker inspect`.

### HAProxy is the remaining SPOF

With two pgbouncers behind HAProxy, the pooler layer is highly available. HAProxy
itself is now the single point of failure. Options to address this:

- **App-node sidecar**: run one HAProxy container on each app node (same
  backend list). Each app connects to `localhost:6432`. A node-level crash
  takes that node's haproxy with it but leaves the others unaffected.
- **Cloud load-balancer**: put a TCP NLB (AWS NLB, GCP TCP LB, Azure LB) in
  front of two HAProxy containers. The cloud LB handles haproxy HA.
- **VIP / Keepalived**: for on-prem, use Keepalived to float a VIP between two
  HAProxy hosts.

Choose the option that matches your infrastructure — documenting the trade-offs
is more valuable than prescribing one approach for all consumers.

### TLS

This template does not terminate TLS between HAProxy and pgbouncer. For
zero-trust networks, configure pgbouncer's `server_tls_*` settings and run
HAProxy in TCP passthrough mode — connections are encrypted end-to-end and
HAProxy only proxies the bytes without decrypting.

### Note on `healthcheck_user`

Verify no role inheritance accidentally grants table access:

```sql
SELECT rolname, rolinherit, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname = 'healthcheck_user';
-- rolinherit must be false, all others false.
```
