# ADR-0006: The e2e suite shares one module registry, one application and one database container

- **Status**: Accepted
- **Date**: 2026-08-26

## Context

`nx run api:e2e` took 126 s wall clock for 82 tests. Vitest's own breakdown put
84 s of that in `import` and 17 s in `tests` — the assertions themselves were
never the cost. Three structural choices produced it:

1. `fileParallelism: false` with Vitest's default per-file isolation. Every one
   of the nine spec files pulls `AppModule`, so the entire Nest + Fastify +
   Prisma + BullMQ graph was transformed and evaluated into a fresh module
   registry nine times, at roughly 9.3 s each.
2. Each spec called `createTestApp()` in `beforeAll`, so the DI container was
   instantiated, Fastify was booted and Prisma/Redis connections were opened
   nine times.
3. The Postgres container ran with default durability settings, and
   `truncateAll()` runs before every test — 82 `TRUNCATE ... CASCADE`
   statements, each paying a WAL fsync that a container destroyed minutes later
   can never benefit from. Postgres and Redis were also started sequentially.

Separately, `TESTCONTAINERS_REUSE=true` — documented as the fast local loop —
aborted on its second run: `provisionRlsRole` issued `DROP ROLE`, which
Postgres refuses once the role holds grants.

## Decision

**One worker, one module registry.** `vite.e2e.config.ts` keeps
`fileParallelism: false`, which pins `maxWorkers` to 1, and adds `isolate: false`
with `pool: 'threads'`. All spec files execute in that single worker, which
evaluates the module graph once. Vitest 4 removed `poolOptions`, so
`poolOptions.threads.singleThread` is neither available nor needed —
`fileParallelism: false` already delivers the single worker.

**One application instance.** `createTestApp()` memoises the boot promise in
module scope, which now survives across spec files. Specs no longer call
`app.close()` in `afterAll`; `test-app.ts` closes the app and the throttler
Redis client on `process.once('beforeExit')`.

**Ephemeral-database Postgres settings.** The Testcontainers Postgres and the
CI service container both run with `fsync=off`, `synchronous_commit=off` and
`full_page_writes=off`. Postgres and Redis start concurrently.

**Idempotent RLS provisioning.** `provisionRlsRole` creates the role only when
absent and re-asserts its attributes otherwise, instead of dropping and
recreating it.

**CI reuses the job's service containers.** `integration.yml` exports
`E2E_DATABASE_URL` / `E2E_REDIS_HOST` / `E2E_REDIS_PORT`, taking the branch
`global-setup.ts` already had, so the job stops booting a second Postgres and
Redis through Testcontainers alongside the ones it already declares.

Result: 126 s → 21 s, same 82 tests.

## Consequences

Isolation now comes from resetting external state, not from discarding the
module registry. `truncateAll()` and `resetRateLimitBudget()` are what keep
specs independent, and a spec that mutates module-level state in an imported
module will leak it into whichever spec runs next. The one such holder in the
suite is the in-process storage stub in `test-app.ts`, which is keyed by upload
id and therefore collision-free.

Sharing the application means the Fastify rate-limit buckets — in-memory, keyed
by `ip:email`, per route — now span the whole run rather than one file. This is
safe only because every spec that signs users up derives a unique email; the
sole exception, `auth.e2e-spec.ts`, uses fixed addresses that no other spec
touches. **A new spec that signs up with a fixed email can silently exhaust a
bucket for a later spec.** Derive the email per test.

Vitest exposes no per-worker teardown hook, so the shared app is closed on
`beforeExit`. If a stray handle keeps the loop alive that hook never fires; the
worker is terminated by Vitest and the containers are stopped by
`global-setup.ts`'s `teardown`, so this is a clean-shutdown path rather than the
only one.

Turning off `fsync` trades crash recovery for speed. That is free for a database
that is discarded at the end of the run and must never be applied to a container
whose data outlives it.

We would know this was wrong if specs started failing depending on execution
order, or if a 429 appeared in a spec that does not assert one — both point at
shared state that survives `truncateAll()`.

## Alternatives rejected

**Keep per-file isolation and only share the containers.** This is the state
that measured 126 s; it leaves the dominant cost, re-importing the module graph
nine times, untouched.

**Run spec files in parallel instead of sharing.** Every file would still pay
its own import and boot, and they would contend for one Postgres — the
`TRUNCATE` in `beforeEach` is not safe against a concurrently running spec
without a database per worker, which costs more than it saves at this suite
size.

**A custom resettable store for `@fastify/rate-limit`.** It would make bucket
state resettable per test and remove the unique-email requirement, at the price
of no longer exercising the store the application actually ships with. The
requirement is cheap to satisfy and is documented above instead.

**ESLint `--cache` to speed up linting.** ESLint invalidates its cache on file
content and config only, so a type-aware rule reporting on file B because of a
change in file A would serve a stale result. Nx already caches lint per project
(2.5 s for a fully cached workspace lint), which covers the same ground without
the correctness risk.
