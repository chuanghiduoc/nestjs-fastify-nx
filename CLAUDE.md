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

**Composition discipline (anti-bloat)**: `scope:composition` libs are **orchestrators only** — they wire HTTP routes + call CQRS handlers from multiple modules. Business rules MUST live on the domain entity / value object of the owning module. If a composition lib starts growing its own `domain/` or `application/` layer, the rule is being broken: the logic belongs in a module, and what's missing is a domain event from one module that another module listens to (use the outbox / EventEmitter pattern). The boundary lint will not catch this — it's a code-review smell.

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
  dtos/            application transport types — PURE TS, no @nestjs/swagger
                   nor class-validator decorators. Application stays
                   framework-agnostic so a handler can be reused from REST,
                   GraphQL, or a queue consumer without dragging HTTP shape.
infrastructure/
  repositories/    Prisma adapters of domain ports
presentation/
  controllers/     HTTP handlers (REST)
  dto/             request/response DTOs (class-validator + Swagger decorators
                   live HERE only — never reuse an application DTO as a
                   presentation DTO, otherwise application starts depending
                   on @nestjs/swagger and the boundary collapses)
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
6. **Conventional Commits** enforced by lefthook + commitlint. Prefixes: `feat`, `fix`, `chore`, `test`, `docs`, `refactor`, `ci`, `perf`, `build`, `revert`. Subjects MUST be lowercase (commitlint `subject-case: lower-case`), max 100 chars.
7. **DTOs**: validated with `class-validator`, transformed with `class-transformer`, documented with `@nestjs/swagger` decorators. Re-export from module barrel only what consumers (composition libs, controllers) need — keep internals private.
8. **Module boundaries are sacred** — if lint fails on `@nx/enforce-module-boundaries`, fix the architecture, do not relax the rule.
   8a. **Pre-commit gate (mandatory)** — before any commit, run `pnpm nx affected -t lint test build typecheck --base=main`. Typecheck must be green (commitlint won't catch TS errors). For changes touching `apps/api/`, also run `pnpm nx run api:e2e` locally before pushing — CI integration job will block the PR otherwise. Write tests defensively: unit-test domain logic + handler edge cases, integration-test repositories against real Postgres (Testcontainers), and add an e2e spec for every new endpoint or middleware behavior. Coverage targets: domain + application ≥ 90 %, infrastructure ≥ 60 %, presentation ≥ 30 %.
9. **API contract is fixed** — successful 2xx returns the resource **directly** (Stripe-style, no `{ data, meta }` envelope); list endpoints return `ListResponseDto<T>` via `@ApiPaginatedResponse`. Errors are **RFC 9457 Problem Details** (`application/problem+json`) emitted by the global exception filter — never hand-roll error bodies. For domain violations throw `BusinessRuleException` from `@nestjs-fastify-nx/core`; for input validation, the global `ProblemDetailsValidationPipe` already handles it. Decorate controllers with `@ApiCommonErrors` from `@nestjs-fastify-nx/contracts` so Swagger documents the error responses. Naming: camelCase JSON keys, snake_case error `code` values (see `ERROR_CODES`), kebab-case HTTP headers (`X-Request-Id`).
   - **Pagination**: **Cursor is the default for resource lists** (`?limit=20&startingAfter=<opaque-cursor>` via `CursorPaginationDto`). Rationale: every list endpoint here serves growth tables (users, audit-log, outbox-derived feeds) where OFFSET scans and COUNT(\*) degrade as the table grows; cursor stays O(log N) regardless of position and is stable under concurrent inserts/deletes. Offset (`?page=1&pageSize=20` via `PaginationDto`, `pageSize` capped at 100) is allowed only when the UX truly requires "Page 5 / 127" jump-to-page navigation — document why on the controller when introducing one. List endpoints return Stripe-style flat envelope `ListResponseDto<T>` = `{ object: 'list', url, data: T[], hasMore, lastCursor?, totalCount?, page?, pageSize? }` via `toListResponse()` / `toCursorListResponse()` (`libs/contracts/src/lib/dto/list-response.dto.ts`). Single-resource fetches stay un-enveloped. `totalCount` is exposed in the body — no `X-Total-Count` header (Stripe pattern).
   - **Sorting**: `?sort=createdAt:desc,name:asc` (CSV, colon-separated field:direction) is the agreed convention. Add a `SortDto` to the query when implementing — not currently consumed by any list handler.
   - **Filtering**: simple key=value (`?status=active`); complex filters use dedicated query DTOs (see `ListUsersFilterDto extends PaginationDto`) — no magic `?filter[field][op]=val` syntax.
   - **Response headers**: `X-Request-Id` echoed on every response. No cursor `Link` header — clients follow `hasMore` + the last id in `data[]`.
   - **Upload**: presign-confirm pattern (`POST /api/v1/upload/{presign,confirm}`). Browser uploads bytes directly to S3 via the issued policy; server only HEADs the object on confirm and verifies size + MIME against the magic-byte allow-list in `libs/modules/upload/src/presentation/controllers/file-signature.ts`. `UPLOAD_MAX_FILE_BYTES` is the single source of truth — wired into both `@fastify/multipart` and the controller's policy cap so both layers reject at the same threshold.
   - **Cursor encoding (when implementing)**: when wiring `toCursorListResponse`, the cursor passed back to clients MUST be `base64url(${sortField.toISOString()}:${id})` — never the raw id alone, otherwise rows with identical timestamps duplicate or drop across pages. Decode in the repository layer with `WHERE (sortField, id) < (cursorTs, cursorId)`.
   - **`totalCount` skip policy**: handlers should omit `totalCount` (leave undefined) whenever the underlying table is large enough that COUNT(\*) becomes a hot path. Clients already follow `hasMore` for navigation; total is a UX nicety, not a contract. Never return `-1` — undefined IS the "unknown" signal in the Stripe envelope.
   - **Sensitive-field redaction**: do NOT rely on `ClassSerializerInterceptor` / `@Exclude`. The repo's policy is _explicit DTO mapping_ — handlers project domain entities into purpose-built DTOs (e.g. `UserProfileDto`) that simply do not declare sensitive columns. Logger redact list (`libs/shared/src/lib/logger-redact.ts`) covers the same fields for structured logs.
   - **`X-Request-Id` is automatic** — set by `CorrelationIdMiddleware` (NestJS layer) and `fastify-error-handler` (Fastify-level errors before pipeline). Never set it manually in a controller; it always echoes the incoming `x-request-id` or mints a fresh one.

## Common gotchas

- **`nx show project` over `cat project.json`** — `project.json` is partial; the resolved config (with inferred targets from plugins) only appears via `nx show project <name> --json`.
- **Nx daemon caching**: after creating a new lib, run `pnpm nx reset` if `nx show projects` doesn't see it.
- **Better Auth + Socket.io**: WebSocket upgrades validate the same `better-auth.session_token` cookie via `createWsAuthMiddleware` (in `apps/api/src/websocket/ws-auth.adapter.ts`).
- **Swagger codegen**: `apps/api/src/common/swagger/codegen-app.module.ts` is an HTTP-only module used by `export-spec.ts` for spec generation — keep it in sync when adding feature modules to `AppModule`. It deliberately drops Socket.io/GraphQL/Sentry/Metrics because provider init (DB connections, Sentry client init, BullMQ workers) would leak resources or fail in CI. Spec export only needs the HTTP layer.
- **pnpm overrides** in `package.json` pin transitive vulnerable versions (fastify, picomatch, brace-expansion, protobufjs, …). Trivy may still flag declared ranges in transitive `package.json` files — that's a scanner artifact; runtime resolves to the override. `lefthook` bundles a Go binary; Go stdlib CVEs (e.g. CVE-2026-25679..42499) are only patched when upstream releases a new binary — watch [evilmartians/lefthook releases](https://github.com/evilmartians/lefthook/releases) and bump the devDependency when a patched version ships.
- **Migration app** (`apps/migration`) has an empty allow-list for module boundaries on purpose. Do **not** import domain code there — schema rollouts must stay decoupled from runtime business logic.
- **TypeScript 6 tsconfig rules**: `baseUrl` is removed (deprecated); path aliases still work via `tsconfig.base.json` `paths`. Do not re-add `baseUrl`. Default inheritance is `ES2022` / `NodeNext` / `NodeNext` from `tsconfig.base.json`. Apps override `module: "CommonJS"` + `moduleResolution: "Node10"` only because Webpack 5 requires CommonJS output — this is a bundler constraint, not a TS 6 issue. Libs inherit all settings from base; do not duplicate `strict*`, `target`, `module`, or `moduleResolution` in `tsconfig.lib.json`. The `ignoreDeprecations: "6.0"` grace period ends at TS 7 — no further suppressions will be possible.
- **VS Code "Invalid value for '--ignoreDeprecations'"**: VS Code's bundled TypeScript (often older) flags `"6.0"` as invalid. Force the workspace TS via `.vscode/settings.json` → `"typescript.tsdk": "node_modules/typescript/lib"` (committed). If still red after pull: Command Palette → "TypeScript: Select TypeScript Version" → "Use Workspace Version".
- **Auth rate-limit + body/multipart caps**: Fastify plugin `@fastify/rate-limit` guards `/api/auth/*` with a TWO-TIER scheme (Auth0/Cognito pattern). STRICT bucket on credential paths (`sign-in/email`, `sign-up/email`, `request-password-reset`, `reset-password`) — `AUTH_RATE_LIMIT_MAX=5` per `AUTH_RATE_LIMIT_WINDOW_MS=900000` keyed by IP+email. LOOSE bucket on every other `/api/auth/*` route (sign-out, get-session, list-sessions, change-email, delete-user, …) — `AUTH_SESSION_RATE_LIMIT_MAX=60` per `AUTH_SESSION_RATE_LIMIT_WINDOW_MS=60000` keyed by IP. The rate-limit registration MUST be before the betterAuthHandler hook because `reply.hijack()` skips NestJS's ThrottlerGuard. Multipart upload + raw body limits via `HTTP_BODY_LIMIT_BYTES` (1 MB) and `UPLOAD_MAX_FILE_BYTES` (10 MB). Validate these before going live.
- **FSTWRN004 at boot is expected and harmless.** Fastify warns once when `setErrorHandler` is called on a scope that already has one. We intentionally override the default errorHandler that `NestFastifyAdapter` installs (via `applyFastifyErrorHandler()` in `main.ts`) so Fastify-level failures — body parser, multipart parse, `@fastify/rate-limit` 429, FST*ERR*\* — emit RFC 9457 problem+json instead of Fastify's default JSON shape. The warning is a one-shot at boot, does NOT affect runtime, and is left in stderr on purpose (suppressing it would also need to filter `process.emit('warning', ...)` and Fastify caches the reference at import time, so a runtime filter loses the race anyway).
- **BullMQ custom jobId MUST NOT contain `:`** — BullMQ reserves `:` for its internal Redis key scheme (`<prefix>:<queue>:<id>:state`) and throws `Custom Id cannot contain :` at `Job.validateOptions`. Use `__` as separator instead. Pattern: `<purpose>__<discriminator>[__<discriminator>…]`. Examples in this repo: `welcome-email__${event.eventId}`, `auth-email__${templateId}__${to}__${ts}`, `dlq__${originalJobId}`. The error is async — it surfaces inside a `failed` queue-event handler or a `BackgroundTask` log line (NOT at the call site), so it is easy to miss in a smoke test. Grep for `\`[^\`]_:._\${._}._\``in`add(...)` callsites whenever you change job naming.
- **Better Auth email flows are FE-owned UI, BE-owned validation.** Backend wires `sendResetPassword` + `emailVerification.sendVerificationEmail` + `user.deleteUser.sendDeleteAccountVerification` in `libs/infra/auth/src/lib/better-auth.config.ts`. Each callback enqueues a BullMQ job on `QUEUE_NAMES.EMAIL_NOTIFICATION`; the worker process owns SMTP. The link inside the email points at **`FRONTEND_BASE_URL`** — the SPA host that renders these pages:
  - `GET /reset?token=<t>` → FE form (new password), submits `POST /api/auth/reset-password { token, newPassword }`
  - `GET /verify-email?token=<t>` → FE confirmation page, submits `POST /api/auth/verify-email { token }`
  - `GET /delete-account?token=<t>` → FE confirmation page, submits `POST /api/auth/delete-user/callback { token }` (Better Auth handles)

  The API has NO server-rendered HTML for these flows. `FRONTEND_BASE_URL` is REQUIRED in production — `resolveFrontendBase()` throws on boot if missing. In dev it falls back to `BETTER_AUTH_URL` with a runtime warning so smoke tests can still verify the dispatch path, but the link itself will 404 in a real browser. When adding a new auth-side email, mirror the dispatcher pattern — never call `nodemailer` from the API process.

- **Outbox has TWO write paths — neither is `eventEmitter.emit()` in a command handler.** All domain events land in `outbox_events`; `OutboxRelayService` drains it (poll interval `OUTBOX_POLL_INTERVAL_MS`, batch `OUTBOX_BATCH_SIZE`, listener tx budget `OUTBOX_TX_TIMEOUT_MS` default 30s). The two producer paths:
  1. **Postgres AFTER INSERT/DELETE triggers** (`prisma/migrations/20260501000000_init/migration.sql:131-217`) — used for the three Better Auth-driven events (`users.registered`, `users.logged_in`, `users.logged_out`). Reason: Better Auth commits its writes outside the NestJS request pipeline, so a Nest-side hook would race the commit and could lose events on crash. The trigger fires inside the same tx as the source row — both commit or neither. Payload shape mirrors `OutboxPublisher.serializePayload()` so the relay rebuilds the in-memory event without a special path.
  2. **`OutboxPublisher.publishAll(events)`** (`libs/infra/messaging/src/lib/outbox-publisher.service.ts`) — the app-level adapter for `EventPublisherPort`. MUST be called from inside a `prisma.$transaction()` interactive tx alongside aggregate writes, so the outbox row commits atomically with the state change. No producer currently consumes this path — it is the intended channel for any new domain event that originates from a CQRS command handler.

  Rules when adding a new domain event:
  - Mutation comes from Better Auth or another tool that bypasses Nest → write a new trigger in a fresh migration (path 1).
  - Mutation comes from a Nest command handler → inject `EventPublisherPort` and call `publishAll(...)` inside the same `$transaction` (path 2).
  - Never call `eventEmitter.emit()` or `queue.add(...)` directly from a command handler — events are lost on tx rollback. Fire-and-forget side-effects (cache invalidation, magic-byte verification, transactional emails fired after a successful commit) belong in `application/listeners/`, not in the handler.

  If events hang: check `OutboxRelayService` liveness, raise `OUTBOX_TX_TIMEOUT_MS` or shrink `OUTBOX_BATCH_SIZE` in `libs/infra/messaging`.

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

<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                        | Use when                                               |
| --------------------------- | ------------------------------------------------------ |
| `detect_changes`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context`        | Need source snippets for review — token-efficient      |
| `get_impact_radius`         | Understanding blast radius of a change                 |
| `get_affected_flows`        | Finding which execution paths are impacted             |
| `query_graph`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview` | Understanding high-level codebase structure            |
| `refactor_tool`             | Planning renames, finding dead code                    |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
