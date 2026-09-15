<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

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

> `CLAUDE.md` and `AGENTS.md` are kept byte-identical below the Nx block. Edit one, copy to the other.

Production-grade NestJS + Fastify + Nx monorepo. DDD/CQRS, Better Auth (cookie sessions), GraphQL (Mercurius), Socket.io, BullMQ, OpenTelemetry, Sentry. Four runnable apps: `api`, `worker`, `scheduler`, `migration`.

**Read `docs/agent-gotchas.md` before touching dependencies, `main.ts`, the outbox, metrics, or auth rate-limiting.** It holds the failure modes that already cost this repo a production incident — they are not re-stated here.

## Language

Reply to the maintainer in **Vietnamese**. Code, identifiers, commit messages, and committed documentation stay in English.

## Stack

Node 24 · pnpm 11.14 · TypeScript 6 · NestJS 11 + Fastify 5 · Prisma 7 (`@prisma/adapter-pg`) · Better Auth 1.6 · Vitest 4 + Testcontainers · Webpack 5 + swc.

Three things that are **not** what you would guess:

- Auth is **Better Auth cookie sessions, not JWT**. Cookie `better-auth.session_token`, mounted at `/api/auth/*`. Never reintroduce refresh-token / access-token / JWT-blacklist plumbing.
- Test runner is **Vitest, not Jest**.
- Builds do **no type-checking** (swc transpiles per-file). Type errors surface only in the separate `typecheck` target. Consequence: **interface/type-only imports MUST use `import type`** — a value import of an interface used as an `@Inject` param type leaks into `design:paramtypes` and webpack warns `export 'X' was not found`. Class imports stay value imports.

## Architecture & boundaries

DDD layering enforced by Nx tags + `@nx/enforce-module-boundaries` (`eslint.config.mjs`):

| Tag                                                | May depend on                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `scope:api`                                        | modules, composition, infra, core, shared, contracts               |
| `scope:worker` / `scope:scheduler`                 | modules, infra, core, shared, contracts (**no** composition)       |
| `scope:composition`                                | modules, composition, infra, core, shared, contracts               |
| `scope:modules`                                    | infra, core, shared, contracts — **never another `scope:modules`** |
| `scope:infra`                                      | core, shared, contracts, infra                                     |
| `scope:core` / `scope:contracts`                   | shared                                                             |
| `scope:shared` / `scope:tools` / `scope:migration` | nothing (leaves)                                                   |
| `scope:client`                                     | shared, contracts                                                  |
| `scope:testing`                                    | modules, infra, core, shared, contracts                            |

**Boundaries are sacred.** If lint fails on `@nx/enforce-module-boundaries`, fix the architecture — never relax the rule and never add a cross-module import. Cross-context aggregation goes through `scope:composition`, one-way.

`scope:composition` libs are **orchestrators only**: wire routes, call CQRS handlers from several modules. A `domain/` or `application/` layer growing inside one means the rule is being broken — the logic belongs in the owning module, and what is missing is a domain event. Lint will not catch this.

Test files (`*.spec.ts`, `*.integration.ts`, `e2e/**`) are exempt from boundary rules.

## Where things live

```
apps/{api,worker,scheduler,migration}/     api owns HTTP+GraphQL+WS; e2e at apps/api/e2e/
libs/modules/<context>/                    bounded contexts (DDD, see below)
libs/composition/admin/                    cross-context orchestration + Bull Board
libs/{core,infra,contracts,shared}/        auth, errors, outbox · db/redis/storage/… · DTOs · utils
libs/testing/                              Testcontainers + DatabaseCleaner harness
libs/api-client/                           Orval output from the live OpenAPI spec
prisma/ docker/ scripts/ docs/ tools/generators/
```

## DDD module layout

```
domain/{entities,value-objects,events,ports}/
application/{commands,queries,listeners,ports,dto}/<name>/
infrastructure/{repositories,dispatchers}/
presentation/{controllers,dto}/
testing/                                   in-module doubles
<context>.module.ts                        full slice (api hosts this)
<context>-listeners.module.ts              listeners only (worker/scheduler)
index.ts                                   barrel — only what consumers need
```

Rules that bite:

- Folders are **plural for peers**, `dto/` is **always singular**. Never `dtos/`.
- `application/dto/` is **pure TS** — no `@nestjs/swagger`, no `class-validator`. Those live in `presentation/dto/` only, and a presentation DTO is never reused as an application DTO.
- A repository port goes in `domain/ports/`; an outbound capability with no domain meaning (queue dispatcher, mailer) goes in `application/ports/`.
- **CQRS**: handlers are found by the bus explorer (`CqrsModule.forRoot()` per runnable app) — never inject a handler directly, dispatch through `CommandBus`/`QueryBus`. Commands/queries extend `Command<T>`/`Query<T>`; the barrel exports them and their result types, **not** the handlers.
- **Domain events flow through the outbox**, never the in-memory `@nestjs/cqrs` EventBus, and never `eventEmitter.emit()` / `queue.add()` from a command handler — those are lost on rollback. Two producer paths and the full ruleset: `docs/agent-gotchas.md`.

## Common workflows

```bash
./scripts/gen-env.sh && pnpm install    # bootstrap; ./scripts/doctor.sh to verify prerequisites
./scripts/build-dev.sh                  # build + boot full dev stack
./scripts/dev.sh [app]                  # hot reload: infra in Docker, app on host

pnpm nx affected -t lint test build typecheck --base=origin/main   # the gate
pnpm nx test <project> -- --coverage    # coverage is CI-only locally; reproduce before pushing
pnpm nx run api:e2e                     # Testcontainers; TESTCONTAINERS_REUSE=true to persist

pnpm db:migrate --name <slug>           # see the single-migration policy below
pnpm db:deploy | db:seed | db:studio | db:generate
pnpm codegen:full                       # OpenAPI spec → orval → libs/api-client
pnpm sync | reset | clean | graph        # after creating libs / stale caches
pnpm gen:module <name> | gen:composition | gen:lib | gen:app | rm:project
```

**A new lib needs `pnpm install` before it resolves.** There are no `tsconfig` `paths` — `@nestjs-fastify-nx/*` resolves through pnpm workspace symlinks, so a `workspace:*` entry is inert until install runs. `pnpm gen:module` does this for you. `nx sync` maintains tsconfig references only; it does **not** maintain `package.json` dependencies.

**Single migration by design**: a fork runs one clean `20260501000000_init` rather than replaying history. Pre-release schema changes are folded into it, then verified with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` printing an empty migration. Once a fork has deployed, switch to additive migrations.

## Conventions agents must respect

1. **Production quality only** — public boilerplate, not a prototype. No half-finished code, no TODOs in main.
2. **Zero comments in new code.** Not "few" — zero, including JSDoc and TODO. Meaning is carried by naming, small functions, explicit types and tests. Anything that cannot be is a _decision_ and belongs in `docs/adr/`. Pre-existing comments stay; never run a comment-stripping sweep as a side effect.
3. **No mocks for DB tests** — integration tests hit real Postgres via Testcontainers (`libs/testing`).
4. **e2e lives at `apps/api/e2e/`**, never `apps/api/test/`. Use `createTestApp()`.
5. **Conventional Commits** (lefthook + commitlint): `feat|fix|chore|test|docs|refactor|ci|perf|build|revert`, subject lowercase, ≤100 chars.
6. **Validation is declarative.** Pipes and decorators, not hand-rolled `if`/regex. Id path params MUST be `@Param('id', new ParseUUIDPipe({ version: '7' }))` — a bare `ParseUUIDPipe` accepts any version. Read the caller via `@CurrentUser() user: AuthenticatedSession` from `@nestjs-fastify-nx/infra-auth` — never `@Req() req: FastifyRequest & { user }`, and never a per-module copy of that decorator. Reserve `if`/`else` for authorization logic no decorator can express.
7. **Pre-commit gate (mandatory)**: `pnpm nx affected -t lint test build typecheck --base=origin/main` — `origin/main`, not `main`, or `affected` silently returns nothing. Changes under `apps/api/` also need `pnpm nx run api:e2e`. Coverage thresholds are 60% for every project via `vitest.shared.ts`.
8. **Authorization has two axes that must not be mixed.** `User.role` (`ADMIN`/`USER`) + `@Roles()` is the _provider's own staff_, for back-office surfaces only. Every tenant-facing endpoint uses `@RequirePermission()` + `PermissionGuard` instead. Putting `@Roles('ADMIN')` on a tenant endpoint locks out the org owner **and** exposes other tenants. Two engines (Better Auth's plugin for `/api/auth/organization/*`, `PostgresPbacAdapter` for `/api/v1/*`) must stay in step — details in `docs/agent-gotchas.md`.

### API contract (fixed)

Successful 2xx returns the resource **directly** — no `{ data, meta }` envelope. Lists return `ListResponseDto<T>` via `@ApiPaginatedResponse`. Errors are **RFC 9457 Problem Details** from the global filter; never hand-roll an error body. camelCase JSON keys, snake_case `code` values from `ERROR_CODES`, kebab-case headers.

**Throw `DomainException` and pick a `kind`, never a status** — the same handlers run under REST, GraphQL and the scheduler, so only the transport assigns one. Never `extends HttpException` in `libs/core`, a domain entity, or an application handler.

| `kind`       | Status | Throw when                                                                  |
| ------------ | ------ | --------------------------------------------------------------------------- |
| `malformed`  | 400    | Input could not be parsed at all                                            |
| `validation` | 422    | Parsed but broke a fixable rule — the default                               |
| `not_found`  | 404    | Absent, or the caller must not learn it exists                              |
| `conflict`   | 409    | Duplicate key, stale version, work in flight — pair with `permanent: false` |
| `forbidden`  | 403    | Authenticated but not permitted                                             |

`permanent` defaults to **true**: a rejected rule never becomes valid by waiting, so the outbox parks the row instead of burning retries.

- **Pagination**: cursor is the default (`?limit=&startingAfter=`). Offset is allowed only for true jump-to-page UX — document why on the controller. Cursor MUST be `base64url(${sortField.toISOString()}:${id})`, never the bare id, or rows with equal timestamps duplicate across pages.
- **`totalCount`**: omit it when `COUNT(*)` would be a hot path. `undefined` _is_ the "unknown" signal — never `-1`.
- **Redaction is explicit DTO mapping**, not `ClassSerializerInterceptor`/`@Exclude`: purpose-built DTOs simply do not declare sensitive columns.
- **Client error output is allowlisted, never copied from the thrown error.** Every 5xx is generic in every environment; `errors[]` never echoes the rejected value. Full causes go to logs/Sentry under `requestId`.
- **`X-Request-Id` is automatic** — never set it in a controller. Any layer needing it calls `ensureRequestIds(req.raw, req.headers)`, never `resolveRequestId()`.
- Sorting `?sort=field:desc,…`; filtering plain `key=value` or a dedicated query DTO — no `?filter[f][op]=v`.

Full guides: `docs/error-handling.md`, `docs/code-standards.md`.

## Documentation map

`docs/agent-gotchas.md` (read first) · `architecture.md` · `getting-started.md` · `creating-a-module.md` · `domain-module-anatomy.md` · `environment.md` · `deployment.md` · `security.md` · `observability.md` + `observability-guide.md` · `troubleshooting.md` · `runbook.md` · `code-standards.md` · `error-handling.md` · `scaling-to-services.md` · `adr/` · `CONTRIBUTING.md`

## Knowledge graph (code-review-graph MCP)

Prefer the graph over Grep/Glob/Read when exploring: `semantic_search_nodes` / `query_graph` to find code and trace callers, callees, imports and tests; `get_impact_radius` and `get_affected_flows` for blast radius; `detect_changes` + `get_review_context` for reviews; `get_architecture_overview` for structure. It auto-updates on file changes. Fall back to file scanning only where the graph does not reach.
