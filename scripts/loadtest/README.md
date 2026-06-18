# Load testing (k6)

Measure how much the API stack actually handles — RPS, p95/p99 latency, error
rate — against a locally booted Docker stack. Scenarios target representative
paths: a public probe, a cookie-authenticated read, and the cursor-paginated
admin list.

## Why a dedicated env profile

Two layers cap throughput by design and would otherwise dominate the results:

- **`ThrottlerGuard`** — `THROTTLER_LIMIT=100` per `60s` per IP on every Nest
  route. A single k6 box is one IP, so it hits HTTP 429 almost immediately.
- **Auth rate-limit** — sign-in/sign-up are limited to `5 / 15 min`.

`loadtest.env.example` disables the throttler and raises the auth limits **for
load testing only**. Copy it, set a throwaway `SEED_ADMIN_PASSWORD`, and it also
seeds an admin so the `admin/users` scenario can run.

## Prerequisites

- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) (`brew install k6`,
  `choco install k6`, or `docker run grafana/k6`).
- Docker (for the stack under test).

## Boot the stack

```bash
cp scripts/loadtest/loadtest.env.example scripts/loadtest/loadtest.env
# edit scripts/loadtest/loadtest.env → set a throwaway SEED_ADMIN_PASSWORD
cat .env scripts/loadtest/loadtest.env > .env.bench
docker compose --env-file .env.bench up -d --build --wait
node prisma/seed.mjs   # creates the SEED_ADMIN_* user for the admin scenario
```

`loadtest.env` and `.env.bench` are gitignored (they hold your local password).

The API listens on `http://localhost:3000` (override with `BASE_URL`).

## Run

```bash
# 1. Sanity — one pass over every endpoint, must be 100% green first
k6 run scripts/loadtest/smoke.js

# 2. Sustained load — ramping VUs, the headline numbers (p95/p99, RPS, errors)
k6 run scripts/loadtest/load.js
VUS=200 SUSTAIN=5m k6 run scripts/loadtest/load.js

# 3. Spike — sudden surge, checks recovery and error spillover
PEAK=500 k6 run scripts/loadtest/spike.js

# 4. Stress — climb until thresholds break; the breaching step is the ceiling
STEP=50 STEPS=10 k6 run scripts/loadtest/stress.js
```

With the admin seeded:

```bash
SEED_ADMIN_EMAIL=admin@loadtest.invalid SEED_ADMIN_PASSWORD=AdminLoadTest123! \
  k6 run scripts/loadtest/load.js
```

## Knobs

| Var | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | Target host |
| `VUS` | `50` | Peak virtual users (`load.js`) |
| `RAMP` / `SUSTAIN` | `30s` / `2m` | Ramp + plateau duration (`load.js`) |
| `PEAK` | `300` | Spike peak VUs (`spike.js`) |
| `STEP` / `STEPS` | `50` / `8` | VU increment + number of steps (`stress.js`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | — | Enables the admin scenario |

## Reading results

- **`http_reqs` rate** — sustained RPS the stack served.
- **`http_req_duration` p95/p99** — tail latency; thresholds fail the run when
  breached (per-endpoint via the `name` tag).
- **`http_req_failed`** — error rate; > 1% under sustained load means the stack
  is past its comfortable ceiling.

## Interpreting the ceiling

DB-bound endpoints are gated by `DATABASE_POOL_MAX` (20 connections/instance) and
`(API_REPLICAS + 1) × DATABASE_POOL_MAX ≤ 80`. To push higher, scale replicas
(`API_REPLICAS`) — for prod-parity multi-replica runs use
`scripts/swarm-local-test.sh` — and ensure Postgres `max_connections` (or the
pgbouncer pool) keeps up.
