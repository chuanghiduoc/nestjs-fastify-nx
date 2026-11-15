# Modules-Scale Restructure Design

> Status: approved by maintainer (2026-11-15). Architecture sketch shown and accepted; this document records the full design for the builder.

## Intent and why

The template must stay productive at 100+ bounded contexts. Measured today at 9 contexts: every context costs 6 config files, a workspace package (`pnpm install` + node_modules link per creation), 34 generated files, and 5 test layers. Extrapolated, 100 contexts means ~600 config files, ~3,400 scaffold files, 119 Nx projects. The cost that scales worst is per-context ceremony, not Nx graph time (measured: 2s at 28 projects). The maintainer chose Approach A: one-PR big-bang restructure on a branch, no coexisting patterns.

## Goals

- Module = folder in a single Nx project `libs/modules`. Creating the Nth context adds one folder and zero config files, zero installs.
- Preserve the load-bearing invariants proven by the 23-agent review: CQRS dispatch, outbox (both producer paths), two-axis authorization, RLS + tenant scoping, the fixed API contract, Testcontainers integration tests, e2e on a real NOBYPASSRLS role, docker-smoke.
- Colocate: command + handler in one file per operation; spec files next to the source they test; integration spec next to the repository adapter.
- Test de-duplication: delete mocked-Prisma surface specs where an integration spec covers the same adapter; keep specs that pin business rules and authorization axes.
- Coverage: one aggregate threshold for the modules project instead of nine per-project gates.
- Docs and generator describe the new architecture so the 10th context is created the right way by default.

## Non-goals

- No change to `libs/infra/*`, `libs/core`, `libs/shared`, `libs/contracts`, `libs/composition`, `libs/testing`, or any app bootstrap.
- No change to Prisma schema, migrations, or the outbox relay.
- No change to the REST/GraphQL API surface or the generated client (imports of `@nestjs-fastify-nx/modules-*` change to `@nestjs-fastify-nx/modules/*`; request/response shapes do not).
- No new runtime dependencies.

## Anti-goals

- Two coexisting module patterns (project-per-context AND folder) — the end state must have exactly one.
- Dropping CQRS dispatch (the bus explorer, composition layer, CqrsInstrumentationInitializer, and audit-event publication all depend on it).
- Relaxing any boundary: context-to-context imports stay forbidden; only the enforcement mechanism changes (Nx tags → a custom ESLint rule for context folders; `@nx/enforce-module-boundaries` keeps governing scope-level edges).

## Constraints

- `pnpm nx affected -t lint test build typecheck --base=origin/main` plus `api:e2e`, integration lane, docker-smoke replicated locally green before every push (maintainer's standing rule).
- Conventional commits; zero comments in new code; committed docs in English; `import type` discipline; boundaries sacred.
- `moduleResolution: "bundler"` — the group package uses a `exports` map, no tsconfig `paths`.
- Git `mv` for every file move so history survives.

## Approaches considered

1. **Group project + folder contexts (picked).** One Nx project `libs/modules`; context = folder; boundaries via a custom ESLint rule; colocated files. Trades per-context Nx-affected granularity (unit tests of the whole group rerun on any context change, measured ~2-3s) for constant per-context overhead.
2. **Cheap projects.** Keep project-per-context but strip to tsconfig-path imports (no workspace package per context). Rejected: still ~4 config files and one Nx project per context at 100 contexts; ceremony scales linearly, only the constant improves.
3. **Incremental two-phase.** Establish the group with one reference context, migrate the rest later. Rejected by maintainer: hybrid state on a public boilerplate.

## The design

### Group project

```
libs/modules/
  package.json      name "@nestjs-fastify-nx/modules",
                    exports: { ".": ..., "./<ctx>": "./src/<ctx>/index.ts", ... } (one entry per context)
  project.json      tags: ["scope:modules"]
  tsconfig.json / tsconfig.lib.json / tsconfig.spec.json
  vitest.config.mts aggregate coverage thresholds; integrationTests: true
```

Consumers change `@nestjs-fastify-nx/modules-users` → `@nestjs-fastify-nx/modules/users` and depend on the single group package. The root `".": "./src/index.ts"` export is allowed to stay empty of context internals; apps import per-context paths only.

### Tier anatomy

- **Leaf** (default for a new context): flat folder, ~8-12 files. `ctx.module.ts`, `index.ts`, `ctx.controller.ts`, `ctx.dto.ts`, one colocated `Command+Handler` file per write operation, one colocated `Query+Handler` file per read, `prisma-ctx.repository.ts` + colocated `.integration.spec.ts`, colocated unit specs. No `domain/`, `application/`, `infrastructure/`, `presentation/` subfolders. An entity file may exist flat when invariants demand it.
- **Engine** (promoted when a context has real domain logic, more than a handful of operations, or outbox listeners): current DDD subfolders return (`domain/`, `application/`, `infrastructure/`, `presentation/`), but command/query files colocate their handler and specs sit next to sources.
- **Composition**: unchanged (`libs/composition/*`, orchestrator-only).

Promotion rule (goes in the anatomy doc): start leaf; promote to engine when invariants or listener count force it — never preemptively.

Tier assignment for the existing nine: leaf = `sessions`, `notifications`, `terms`; engine = `users`, `organizations`, `api-keys`, `feature-flags`, `upload`, `audit-log`.

### Colocation rules

- One file per operation containing both the `Command`/`Query` class and its handler, named `create-user.ts`, `list-users-cursor.ts`.
- The context barrel (`index.ts`) still exports commands/queries + result types, never handlers (unchanged rule).
- Listeners-module files stay where a worker/scheduler host imports the slice (`users-listeners.module.ts`, `audit-log-listeners.module.ts`, `notifications-listeners.module.ts`).
- Spec placement: `*.spec.ts` next to the unit under test; `*.integration.spec.ts` next to the repository adapter.

### Boundary enforcement

Custom ESLint rule (`tools/eslint-rules/no-cross-context-imports.mjs`, plain ESM so flat config can load it directly):

- Inside `libs/modules/src/<ctxA>/`, an import of `@nestjs-fastify-nx/modules/<ctxB>` where `ctxB !== ctxA` is an error.
- Inside `libs/modules/src/`, an import of `@nestjs-fastify-nx/modules/<ctx>/<internal-path>` (past the barrel) is an error for every consumer, including apps and composition.
- `libs/modules` root self-import of subpaths is allowed only for the group's own module wiring.
- `@nx/enforce-module-boundaries` keeps governing scope-level edges (modules → infra/core/shared/contracts; composition may import modules; worker/scheduler cannot import composition).

The rule has a unit spec (it is new behavior) exercised with a fixture set.

### Test matrix

- **Keep:** domain entity/VO specs; handler specs that pin business rules (scope ceiling, bucketing, state machines, authorization axes such as the `@Roles` platform vs `@RequirePermission` tenant split in terms); controller specs; every `*.integration.spec.ts`; the entire `apps/api/e2e` suite; infra-level specs (outbox relay/publisher, storage adapters); scheduler task specs.
- **Delete:** mocked-Prisma repository/surface specs where the colocated integration spec covers the same adapter (`sessions-surface`, `api-keys-surface`, `feature-flags-surface`, `notifications-surface`, `terms-surface` surface parts not pinning authorization axes, `prisma-repositories.spec` (organizations), `prisma-user.repository.spec` (mock variant), `prisma-audit-log.repository.spec`, `prisma-stored-file.repository.spec` where integration coverage exists). Each deletion is checked against its integration coverage before removal; anything pinning an authorization axis or a contract shape is kept (possibly merged into the colocated controller spec).
- **Coverage:** `vitest.config.mts` of the group sets the aggregate threshold (60%) on the group's production code; per-project thresholds for the nine old projects disappear with the projects.

### Generator

`pnpm gen:module <name>` produces a leaf-tier folder in `libs/modules/src/<name>/` (~10 files), wires the exports-map entry into `libs/modules/package.json`, and runs no install. `gen:composition` keeps its orchestrator-only scaffold. The generator spec is rewritten against the new output shape.

### Documentation

- `AGENTS.md` + `CLAUDE.md`: "Where things live" and the boundary table updated (module = folder; scope-level edges unchanged; context edges via the custom rule).
- `docs/domain-module-anatomy.md`: rewritten as the tier ladder (leaf → engine → composition) with the promotion rule; colocated snippets replace the separate-file examples.
- `docs/creating-a-module.md`: new generator flow.
- `docs/architecture.md`: dependency diagram updated.
- READMEs: `libs/modules/README.md` new; per-context READMEs move with their folders.

## Builder-check rulings (settled 2026-11-15, recorded here as design)

1. **Coverage after mock-spec deletion.** The group's `vitest.config.mts` excludes adapter files (`src/**/prisma-*.repository.ts`) from the unit-lane coverage denominator — adapters are gated by the integration lane (real Postgres, CI runs it on every PR), which is strictly stronger than mock coverage. Every migration task carries a coverage checkpoint (`pnpm nx test modules -- --coverage`), so a red gate surfaces at context 1, not context 9.
2. **Leaf keeps the two-DTO-kind invariant by naming.** `<ctx>.dto.ts` in a leaf is the presentation DTO — the only file in a leaf that may import `@nestjs/swagger`/`class-validator`; application result types live in the operation files (pure TS). The eslint rule is re-keyed for the group: those imports are allowed only in `**/presentation/**`, `**/*.dto.ts`, `**/*.controller.ts`, scoped to `libs/modules/src/**` — covering both tiers.
3. **Rule + spec location.** `tools/generators/src/eslint-rules/` (inside the `tools-generators` project) so `nx affected` runs the spec in CI.
4. **Removal flow.** The generator scope adds `pnpm rm:module <name>` (delete the folder, drop the exports-map entry, print reference-cleanup steps). The docs sweep is grep-driven, not limited to the files listed above (covers the `pnpm install` note in agent-gotchas and the `modules-upload` import example in troubleshooting).

## What is left to the builder

- Exact per-file placement inside a tier (the ladder above is the contract, not a file manifest).
- Order of the nine migrations (plan starts with `sessions` as the leaf reference, then ascending by size).
- Whether a given surface spec is deletable (rule: delete only when the colocated integration spec covers the same adapter; authorization-axis pins are never deleted).
- The ESLint rule implementation details beyond the three error cases listed.
