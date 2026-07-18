# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Best-Practice Overhaul (2026-05-16)

### Removed

- `AggregateRoot` dead inheritance — domain entities no longer extend it
- `RequestContext` zombie class — removed from codebase; use NestJS `@Req()` + guard injection
- Parallel `UserProfileDto` in application layer — unified to single DTO per shape
- `BetterAuthModule.forRootAsync()` and `BETTER_AUTH_HOOKS` scaffolding — simplified to direct factory
- `libs/modules/admin` (moved to `libs/composition/admin` with `scope:composition` tag)
- `apps/api/src/common/upload` (moved to `libs/modules/upload`)
- Logger duplicates — three `LoggerModule.forRoot()` calls unified to single shared factory
- `BetterAuthHooks` interface and `databaseHooks.user.create.after` block — dead code removed (user registration events flow through Postgres trigger → outbox, not this hook)

### Added

- Auth rate-limit enforcement — `fastify-rate-limit` hook guards `/api/auth/*` (AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS)
- HTTP body + multipart caps — HTTP_BODY_LIMIT_BYTES, UPLOAD_MAX_FILE_BYTES env vars with validation
- Outbox interactive transaction — lock-through-publish semantics with OUTBOX_TX_TIMEOUT_MS timeout
- Health readiness probe for BullMQ — `BullMqHealthIndicator` pings email-notification queue (2s timeout)
- Sentry PII scrubbing — beforeSend filter masks password, token, secret, cookie patterns in event.extra and breadcrumbs
- Metrics IP allowlist — `METRICS_ALLOW_CIDRS` (comma-separated CIDR ranges) with socket.remoteAddress validation
- Metrics IP allowlist health check — `MetricsIpAllowGuard` reads `METRICS_ALLOW_CIDRS` at guard evaluation time
- NX_CLOUD_AUTH_TOKEN for Nx Cloud remote caching in CI
- Shared Testcontainers setup — global-setup/teardown with SIGINT handler for clean container teardown on CI cancel
- docs/code-standards.md — enforcement of logging (pino-only), error handling (BusinessRuleException), DTOs (1 per shape), module boundaries, testing ratios
- docs/runbook.md — 6 sections for ops troubleshooting (health, metrics, outbox, BullMQ, performance, security)
- **Phase 6** — Module generator overhaul: `pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=foo --directory=modules` scaffolds full DDD layout (domain/application/infrastructure/presentation) with zero TODOs, kebab-case validation, correct `scope:*` tag scheme
- **Phase 7** — Ops tooling: `scripts/doctor.sh` (preflight check: Docker, Node, pnpm, ports, env vars), `scripts/teardown.sh` (clean compose stack wrapper), `scripts/build-dev.sh --with-obs` flag, `docker/compose.observability.yml` (opt-in Prometheus + Grafana + Jaeger + OTel collector), MinIO bucket auto-provision + healthcheck
- **Phase 8** — Documentation polish: CLAUDE.md updated (honest HMR comment, .env.example guidance, post-clone sanity check, Better Auth body parser gotcha, generator invocation hints, runbook/code-standards links), new CONTRIBUTING.md (human dev onboarding, 5-minute quick start, daily commands table, PR checklist, troubleshooting table)

### Fixed

- Audit listener no longer silently swallows persistence errors — re-throws to trigger transaction rollback
- GraphQL `me` query delegates to `GetUserProfileHandler` for REST/GraphQL parity
- Hijack handler try/catch + socket.destroy for slowloris mitigation (socket reset on timeout)
- Health indicator timer leaks — clear setTimeout via .finally() in prisma and redis health checks
- E2E test isolation — shared Testcontainers containers + global truncateAll cleanup between test suites
- Sentry sample rate cap at 0.1 in production (avoid over-sampling high-volume services)

## [1.0.0] - 2026-05-01

Initial public release of the boilerplate.

### Added

#### Core platform

- **Four runnable apps** — `api`, `worker`, `scheduler`, `migration` — sharing one Nx workspace and one pnpm lockfile
- **Nx 23** monorepo with `@nx/enforce-module-boundaries` enforcing DDD layering via `scope:*` tags (api, worker, scheduler, migration, modules, composition, infra, core, shared, contracts, testing)
- **Webpack 5** bundler wired with `tsc` compiler so NestJS decorator metadata resolves correctly in production builds
- **TypeScript project references** kept in sync via `nx sync`

#### API surfaces (single Fastify instance)

- **REST** with `@nestjs/swagger` — auto-mounted at `/docs` (Scalar) outside production, deterministic `operationId` factory consumed by Orval codegen
- **GraphQL** via `@nestjs/mercurius` — schema-first, GraphiQL exposed at `/graphiql` in dev
- **Socket.io 4** with `@socket.io/redis-adapter` for cross-pod broadcast; WebSocket upgrades reuse the Better Auth cookie via a custom adapter
- **OpenAPI codegen** — Orval emits a typed REST client into `libs/api-client` from the live spec exported by `CodegenAppModule`

#### Authentication & authorization

- **Better Auth 1.6** for sign-up / sign-in / sign-out / password reset / social providers — cookie sessions backed by Postgres, scrypt password hashing
- **`BetterAuthGuard`** + **`RolesGuard`** wired as global `APP_GUARD` providers; `@Roles('ADMIN')` decorator
- **Cross-context admin module** at `libs/modules/admin` (tag `scope:composition`) exposing `GET /api/v1/admin/users` for ADMIN role
- **Argon2** available alongside scrypt for legacy hashes

#### Domain & infrastructure

- **DDD/CQRS layout** for bounded contexts under `libs/modules/*` (domain / application / infrastructure / presentation)
- **`users` module** — profile lookup with cookie-session guard
- **`audit-log` module** — domain-event listener writes immutable audit rows
- **Prisma 7** with `@prisma/adapter-pg` driver adapter; PostgreSQL 18 with native `uuidv7()`
- **Redis 8** — cache (`cache-manager` + Keyv) and queue (BullMQ) on separate instances
- **Transactional outbox** — `inprocess` (EventEmitter2) and `outbox` (Postgres relay) drivers, switchable via `EVENT_PUBLISHER_DRIVER`
- **Object storage port** — S3 SDK v3 with presigned URLs, MinIO-compatible in dev
- **SMTP** via Nodemailer; Mailpit in dev

#### Background work

- **BullMQ** queues with **Bull Board** UI behind admin auth at `/api/admin/queues`
- **Welcome email** flow — `UserRegistered` domain event → `UserRegisteredListener` → BullMQ job → worker sends mail
- **Dead-letter queues** with helper router (`createDeadLetterRouterClass`)
- **`@nestjs/schedule`** in the dedicated scheduler app — `CleanupTask` purges INACTIVE users 90d+, weekly `VACUUM ANALYZE`; `HeartbeatTask` for liveness
- **File-based liveness probes** for worker (`/tmp/worker-alive`) and scheduler (`/tmp/scheduler-alive`), refreshed every 30s

#### Quality & operations

- **Rate limiting** — `@nest-lab/throttler-storage-redis` for global throttling; per-route overrides
- **File upload** — `POST /api/v1/upload` via `@fastify/multipart`, streams to `StoragePort` (10 MB cap)
- **Pagination utilities** — `Page<T>`, `PageMeta`, `paginationSkip`, `buildPageMeta` in `@nestjs-fastify-nx/shared`
- **UUID v7** (`uuid@14`) for sortable, time-ordered identifiers
- **Zod env validation** — fail-fast on startup for missing/invalid env vars
- **nestjs-pino** structured JSON logging with correlation-id middleware and automatic redaction of `cookie` / `authorization` headers

#### Observability

- **OpenTelemetry SDK** with auto-instrumentations (HTTP, Fastify, NestJS, Prisma, BullMQ, Redis, Pino), OTLP/HTTP exporters
- **Sentry NestJS** integration + `@sentry/profiling-node` continuous profiler
- **Prometheus** exposition at `/metrics` via `prom-client`; default Node + HTTP request histograms
- **Terminus health checks** — DB, Redis cache, Redis queue, memory; liveness and readiness probes

#### Security

- **Five-layer scan pipeline** — Gitleaks, OSV-Scanner, Semgrep, Trivy, Cosign — with parity between local (`scripts/security/scan-all.sh`) and CI
- **Container hardening** — base images pinned by SHA256 digest, non-root UID 1001, `STOPSIGNAL SIGTERM`, tini PID 1, healthcheck via Node `http`, npm CLI vendored stripped from runtime layer
- **SBOM + max-mode SLSA provenance** attestations on every release image
- **Cosign keyless OIDC** signing via Sigstore Fulcio recorded in the public Rekor log
- **pnpm overrides** pinning known-vulnerable transitive deps (fastify, picomatch, brace-expansion, yaml, follow-redirects, @hono/node-server)

#### Tooling

- **Nx generator** at `tools/generators` — scaffold a DDD module with `pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=<context>`
- **Lefthook** pre-commit/pre-push hooks — lint-staged, commitlint, Gitleaks (staged + history)
- **GitHub Actions**:
  - `ci.yml` — lint, typecheck, unit tests, build, secret scan, dep scan
  - `integration.yml` — Vitest integration suite with Testcontainers services
  - `release.yml` — buildx + SBOM + provenance, Trivy gate BEFORE push, Cosign sign, Semgrep gate. Stops at a signed image — deploy is deployment-specific and not wired here
- **Vitest 4** + **Testcontainers** (real Postgres + Redis) + **Supertest** for unit, integration, and HTTP e2e suites

[1.0.0]: https://github.com/chuanghiduoc/nestjs-fastify-nx/releases/tag/v1.0.0
