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
    src/common/ filters, interceptors, swagger, throttler
  worker/       BullMQ consumer
  scheduler/    cron jobs (@nestjs/schedule)
  migration/    one-shot `prisma migrate deploy` + optional seed

libs/
  modules/      bounded contexts (DDD per module — see below)
  composition/  ← if you create one (admin already lives at libs/modules/admin with scope:composition tag)
  core/         auth, errors, events, outbox, validation
  infra/        auth, database, redis, messaging, storage, observability
  contracts/    DTOs, OpenAPI types, GraphQL SDL
  shared/       framework-agnostic utils, types, constants
  testing/      Testcontainers + DatabaseCleaner harness
  api-client/   Orval-generated REST client from live OpenAPI spec

prisma/         schema.prisma, migrations/, seed.mjs
docker/         compose.yml + compose.dev.yml + compose.prod.yml + compose.test.yml
scripts/        build-dev.sh, build-prod.sh, security/*
docs/           architecture, deployment, environment, security, troubleshooting
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
./scripts/build-dev.sh             # builds + boots full dev stack

# Inner loop
pnpm nx serve api                  # HMR via webpack
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

## Common gotchas

- **`nx show project` over `cat project.json`** — `project.json` is partial; the resolved config (with inferred targets from plugins) only appears via `nx show project <name> --json`.
- **Nx daemon caching**: after creating a new lib, run `pnpm nx reset` if `nx show projects` doesn't see it.
- **Better Auth + Socket.io**: WebSocket upgrades validate the same `better-auth.session_token` cookie via `createWsAuthMiddleware` (in `apps/api/src/websocket/ws-auth.adapter.ts`).
- **Swagger codegen**: `apps/api/src/common/swagger/codegen-app.module.ts` is an HTTP-only module used by `export-spec.ts` for spec generation — keep it in sync when adding feature modules to `AppModule`. It deliberately drops Socket.io/GraphQL/Sentry/Metrics to avoid side-effects during spec export.
- **pnpm overrides** in `package.json` pin transitive vulnerable versions (fastify, picomatch, brace-expansion, …). Trivy may still flag declared ranges in transitive `package.json` files — that's a scanner artifact; runtime resolves to the override.
- **Migration app** (`apps/migration`) has an empty allow-list for module boundaries on purpose. Do **not** import domain code there — schema rollouts must stay decoupled from runtime business logic.

## Documentation map

- `README.md` — public landing
- `docs/architecture.md` — module map, boundary table, auth flow
- `docs/getting-started.md` — local setup
- `docs/creating-a-module.md` — DDD generator walkthrough
- `docs/environment.md` — every env var, defaults, validation
- `docs/deployment.md` — Docker, GHCR, Cosign, Coolify
- `docs/security.md` — five-layer scan pipeline (Gitleaks, OSV, Semgrep, Trivy, Cosign)
- `docs/troubleshooting.md` — known failure modes
