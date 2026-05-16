<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

---

# Project: nestjs-fastify-nx

Production-grade NestJS + Fastify + Nx monorepo. DDD/CQRS, Better Auth (cookie sessions), GraphQL (Mercurius), Socket.io, BullMQ, OpenTelemetry, Sentry. Four runnable apps: `api`, `worker`, `scheduler`, `migration`.

## Stack quick reference

- **Runtime**: Node 22, pnpm 10.33, TypeScript 6
- **Framework**: NestJS 11 + Fastify 5
- **ORM**: Prisma 7 with `@prisma/adapter-pg`; schema at `prisma/schema.prisma`
- **Auth**: Better Auth 1.6 — **NOT** JWT. Cookie name is `better-auth.session_token`. Mounted at `/api/auth/*` by `BetterAuthModule` (in `libs/infra/auth`). The auth surface is published at `/api/auth/reference`.
- **Test runner**: Vitest 4 + Testcontainers (real Postgres/Redis) + Supertest. **NOT** Jest.
- **Bundler**: Webpack 5 (NestJS-correct decorator metadata via `tsc` compiler)

## Architecture & boundaries

The monorepo enforces DDD layering via Nx tags + `@nx/enforce-module-boundaries` (see `eslint.config.mjs`):

```
scope:api / scope:worker / scope:scheduler
  → modules, composition, infra, core, shared, contracts

scope:migration
  → empty allow-list (intentional — migration is a thin prisma deploy wrapper)

scope:composition  (cross-cutting modules, e.g. admin)
  → modules, infra, core, shared, contracts

scope:modules  (bounded contexts: users, audit-log, …)
  → infra, core, shared, contracts        # NEVER another scope:modules

scope:infra
  → core, shared, contracts, infra

scope:core / scope:contracts
  → shared
```

**Key invariant**: `scope:modules` cannot depend on another `scope:modules`. Cross-context aggregation goes through `scope:composition` (one-way: composition → modules, never reverse). Do not "fix" lint errors by adding cross-module imports — extract a composition lib instead.

Test files (`*.spec.ts`, `*.integration.ts`, `e2e/**`) are exempt from boundary rules.

## Where things live

```
apps/
  api/          HTTP + GraphQL + WebSocket entrypoint
    e2e/        Supertest e2e suite (NOT apps/api/test/)
    src/common/ filters, interceptors, swagger, throttler, health
  worker/       BullMQ consumer
  scheduler/    cron jobs (@nestjs/schedule)
  migration/    one-shot `prisma migrate deploy` + optional seed (Docker CMD bypasses
                main.ts; the file exists only so Nx sees an entry point. Gated by orchestrator
                via `depends_on: service_completed_successfully` before api/worker/scheduler boot)

libs/
  modules/      bounded contexts (DDD per module — see below)
    upload/     multipart handler (see HTTP_BODY_LIMIT_BYTES, UPLOAD_MAX_FILE_BYTES env)
  composition/  cross-cutting libs
    admin/      admin panel + Bull Board (scope:composition tag; composed into api)
  core/         auth, errors, events, outbox, validation
  infra/        auth, database, redis, messaging, storage, observability
  contracts/    DTOs, OpenAPI types, GraphQL SDL
  shared/       framework-agnostic utils, types, constants
  testing/      Testcontainers + DatabaseCleaner harness
  api-client/   Orval-generated REST client from live OpenAPI spec

prisma/         schema.prisma, migrations/, seed.mjs
docker/         compose.yml + compose.dev.yml + compose.prod.yml + compose.test.yml
scripts/        build-dev.sh, build-prod.sh, security/*
docs/           architecture, deployment, environment, security, troubleshooting, runbook
tools/generators/  Nx generator → `@nestjs-fastify-nx/tools-generators:module`
```

## DDD module layout

Each `libs/modules/<context>/src/`:

```
domain/
  entities/        aggregate roots
  value-objects/   immutable VOs
  events/          domain events
  ports/           repository interfaces (depended on by application/, implemented in infrastructure/)
application/
  commands/        CQRS command handlers
  queries/         CQRS query handlers
  listeners/       domain-event subscribers
  dtos/            application transport types
infrastructure/
  repositories/    Prisma adapters of domain ports
presentation/
  controllers/     HTTP handlers (REST)
  dto/             request/response DTOs (class-validator + Swagger)
<context>.module.ts
index.ts           public barrel — re-export only what consumers need
```

## Common workflows

```bash
# Bootstrap (after clone)
cp .env.example .env && pnpm install
# .env.example documents all required keys; .env is gitignored.
# Run ./scripts/doctor.sh to verify prerequisites + required env vars are set.
./scripts/build-dev.sh             # builds + boots full dev stack

# Verify clean state (optional but recommended after first install)
pnpm nx affected -t lint test build --base=main

# Inner loop
pnpm nx serve api                  # build once then spawn Node; no file watching. For HMR: pnpm nx watch -p api -- pnpm nx run api:build
pnpm nx test <project>             # vitest
pnpm nx affected -t lint test build
pnpm nx run api:e2e                # Testcontainers — Docker required
pnpm nx graph

# Database
pnpm prisma migrate dev --name <slug>
pnpm prisma generate               # already runs in postinstall
node prisma/seed.mjs

# OpenAPI codegen (consumes live spec from CodegenAppModule)
pnpm codegen:full                  # spec → orval → libs/api-client

# Sync after creating libs / moving files
pnpm nx sync
pnpm nx reset                      # if daemon caches go stale

# Scaffolding a new bounded context (DDD layout)
pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=my-feature --directory=modules
# For cross-context composition lib (e.g. admin, billing-report):
pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=my-feature --directory=composition
# Reference: docs/creating-a-module.md for full DDD walkthrough
```

## Conventions agents must respect

1. **Production-quality only** — this repo is a public boilerplate, not a prototype. No half-finished code, no TODOs left in main.
2. **Comments**: only `WHY` comments worth keeping. Remove `WHAT` narration. Never reference task IDs, callers, or "added for X" — those belong in the PR description.
3. **No JWT terminology** — auth is Better Auth cookie sessions. Don't reintroduce `refresh-token`, `JWT blacklist`, `access-token` plumbing.
4. **No mocks for DB tests** — integration tests must hit real Postgres via Testcontainers (see `libs/testing`).
5. **No `apps/api/test/`** — e2e specs live at `apps/api/e2e/`. Use `createTestApp()` from `e2e/test-app.ts`.
6. **Conventional Commits** enforced by lefthook + commitlint. Prefixes: `feat`, `fix`, `chore`, `test`, `docs`, `refactor`, `ci`, `perf`, `build`.
7. **DTOs**: validated with `class-validator`, transformed with `class-transformer`, documented with `@nestjs/swagger` decorators. Re-export from module barrel only what consumers (composition libs, controllers) need — keep internals private.
8. **Module boundaries are sacred** — if lint fails on `@nx/enforce-module-boundaries`, fix the architecture, do not relax the rule.
9. **API contract is fixed** — successful 2xx returns the resource **directly** (Stripe-style, no `{ data, meta }` envelope); list endpoints return `ListResponseDto<T>` via `@ApiPaginatedResponse`. Errors are **RFC 9457 Problem Details** (`application/problem+json`) emitted by the global exception filter — never hand-roll error bodies. For domain violations throw `BusinessRuleException` from `@nestjs-fastify-nx/core`; for input validation, the global `ProblemDetailsValidationPipe` already handles it. Decorate controllers with `@ApiCommonErrors` from `@nestjs-fastify-nx/contracts` so Swagger documents the error responses. Naming: camelCase JSON keys, snake_case error `code` values (see `ERROR_CODES`), kebab-case HTTP headers (`X-Request-Id`).

## Common gotchas

- **`nx show project` over `cat project.json`** — `project.json` is partial; the resolved config (with inferred targets from plugins) only appears via `nx show project <name> --json`.
- **Nx daemon caching**: after creating a new lib, run `pnpm nx reset` if `nx show projects` doesn't see it.
- **Better Auth + Socket.io**: WebSocket upgrades validate the same `better-auth.session_token` cookie via `createWsAuthMiddleware` (in `apps/api/src/websocket/ws-auth.adapter.ts`).
- **Swagger codegen**: `apps/api/src/common/swagger/codegen-app.module.ts` is an HTTP-only module used by `export-spec.ts` for spec generation — keep it in sync when adding feature modules to `AppModule`. It deliberately drops Socket.io/GraphQL/Sentry/Metrics because provider init (DB connections, Sentry client init, BullMQ workers) would leak resources or fail in CI. Spec export only needs the HTTP layer.
- **pnpm overrides** in `package.json` pin transitive vulnerable versions (fastify, picomatch, brace-expansion, …). Trivy may still flag declared ranges in transitive `package.json` files — that's a scanner artifact; runtime resolves to the override.
- **Migration app** (`apps/migration`) has an empty allow-list for module boundaries on purpose. Do **not** import domain code there — schema rollouts must stay decoupled from runtime business logic.
- **TypeScript 6 tsconfig rules**: `baseUrl` is removed (deprecated); path aliases still work via `tsconfig.base.json` `paths`. Do not re-add `baseUrl`. Default inheritance is `ES2022` / `NodeNext` / `NodeNext` from `tsconfig.base.json`. Apps override `module: "CommonJS"` + `moduleResolution: "Node10"` only because Webpack 5 requires CommonJS output — this is a bundler constraint, not a TS 6 issue. Libs inherit all settings from base; do not duplicate `strict*`, `target`, `module`, or `moduleResolution` in `tsconfig.lib.json`. The `ignoreDeprecations: "6.0"` grace period ends at TS 7 — no further suppressions will be possible.
- **VS Code "Invalid value for '--ignoreDeprecations'"**: VS Code's bundled TypeScript (often older) flags `"6.0"` as invalid. Force the workspace TS via `.vscode/settings.json` → `"typescript.tsdk": "node_modules/typescript/lib"` (committed). If still red after pull: Command Palette → "TypeScript: Select TypeScript Version" → "Use Workspace Version".
- **Auth rate-limit + body/multipart caps**: Fastify hook `fastify-rate-limit` guards `/api/auth/*` (AUTH_RATE_LIMIT_MAX=5, AUTH_RATE_LIMIT_WINDOW_MS=900000). Multipart upload + raw body limits set via HTTP_BODY_LIMIT_BYTES (1 MB) and UPLOAD_MAX_FILE_BYTES (10 MB) env vars. Validate these before going live.
- **Outbox interactive tx timeout**: domain mutations trigger Postgres `sql_outbox` inserts; outbox relay publishes within same tx with OUTBOX_TX_TIMEOUT_MS (default 30s). If events hang, increase timeout or reduce batch size in `libs/infra/messaging`.
- **Health readiness BullMQ probe**: `/health/ready` now includes a `BullMqHealthIndicator` that pings the email-notification queue (2s timeout). If queue is not bootstrapped before probe, readiness fails.
- **Metrics endpoint IP allowlist**: `MetricsIpAllowGuard` reads `METRICS_ALLOW_CIDRS` (comma-separated CIDR ranges) and uses `socket.remoteAddress` (not `req.ip`, which is spoofable via X-Forwarded-For). Empty list fails closed (no metrics). Kubernetes typically needs `127.0.0.1/32` or pod CIDR.
- **Better Auth body parser collision**: NestJS global `ProblemDetailsValidationPipe` would consume the request body before Better Auth can read it. Solved via `reply.hijack()` in `main.ts`. If adding new `/api/auth/*` endpoints, bypass the NestJS pipeline the same way.

## Documentation map

- `README.md` — public landing
- `docs/architecture.md` — module map, boundary table, auth flow
- `docs/getting-started.md` — local setup
- `docs/creating-a-module.md` — DDD generator walkthrough
- `docs/environment.md` — every env var, defaults, validation
- `docs/deployment.md` — Docker, GHCR, Cosign, Coolify
- `docs/security.md` — five-layer scan pipeline (Gitleaks, OSV, Semgrep, Trivy, Cosign)
- `docs/troubleshooting.md` — known failure modes
- `docs/runbook.md` — ops runbook (outbox stuck, DLQ full, stuck queue workers, performance)
- `docs/code-standards.md` — coding conventions enforced (logging, error handling, DTOs, boundaries)
- `CONTRIBUTING.md` — human dev onboarding (5-minute quick start, PR checklist)
