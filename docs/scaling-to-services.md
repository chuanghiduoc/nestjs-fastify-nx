# Scaling to services

How this codebase gets split into separately deployed services — and why it is not split today.

## Where the repo already stands

| Property              | State                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Deployable units      | 4 (`api`, `worker`, `scheduler`, `migration`), each with its own Docker target and pruned `package.json`               |
| Bounded contexts      | 9 (`users`, `audit-log`, `upload`, `organizations`, `api-keys`, `notifications`, `feature-flags`, `terms`, `sessions`) |
| Cross-context imports | Blocked — `libs-groups/no-cross-context-imports`; only a declared edge may import another context's `contract`         |
| Table ownership       | Enforced by `libs-groups/prisma-table-ownership`: one owner per table, plus named grants for the known exceptions      |
| Event payloads        | Per-event zod schemas in each publisher's `contract` entry point (`@nestjs-fastify-nx/modules/<ctx>/contract`)         |
| Cross-context FKs     | Only to the Better Auth core (`users`, `organizations`) — never between two feature contexts                           |
| Cross-process events  | `outbox_events` + `OutboxRelayService`, at-least-once, with backoff                                                    |
| Event names           | `DOMAIN_EVENTS` in `@nestjs-fastify-nx/shared`, locked to the trigger SQL by `domain-events.spec.ts`                   |

Foreign keys fall into two groups. Better Auth's own tables (`sessions`, `accounts`, `members`,
`invitations`, `teams`, `organization_roles`) reference `users`/`organizations` and move together as
one unit. The newer feature tables (`api_keys`, `notifications`, `feature_flags`, `term_acceptances`)
also reference that core, which is deliberate: the core is the last thing to be split, so a foreign
key pointing _into_ it costs nothing until Stage 3.

What matters is what is absent — **no feature context references another feature context**.
`stored_files.userId` and `audit_logs.userId` carry no foreign key at all so the scheduler can still
purge objects after a user row is gone.

## Table ownership

`tools/generators/src/eslint-rules/table-ownership.map.mjs` is the single source of truth. Every
Prisma model has one owner: a context folder (`modules/<ctx>`) or an infra folder for tables that no
context owns (`infra/messaging` for `outbox_events`, `infra/auth` for `accounts` and
`verifications`). A spec fails when a model in `prisma/schema.prisma` has no owner.

The lint rule runs in `libs/modules/src/**` and `apps/*/src/**`. It reports a Prisma delegate call,
a relation key inside a query, or a raw-SQL table name when the accessor does not own the table and
holds no grant. A `read` grant does not permit writes. Today the map declares these grants:

| Accessor                | Table                                                                     | Access | Reason                                               |
| ----------------------- | ------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| `modules/organizations` | `users`                                                                   | read   | Names the personal workspace after the user          |
| `modules/users`         | `members`                                                                 | read   | Scopes the member list to one organization           |
| `apps/api`              | `outbox_events`                                                           | read   | Outbox lag metric                                    |
| `apps/scheduler`        | `users`, `stored_files`, `outbox_events`                                  | write  | Retention purges and the orphan-file sweep           |
| `apps/scheduler`        | `sessions`, `verifications`, `invitations`, `notifications`, `audit_logs` | write  | Retention purges and audit partition maintenance     |
| `apps/scheduler`        | `organizations`                                                           | read   | The orphan-file sweep finds files of deleted tenants |

These grants are the exact list of places that a split must replace with an event or an API call.
The rule cannot see a table name that is built at run time. `BatchedPurgeRunner` takes its table
from a config object, and the audit partition functions name `audit_logs` inside SQL. The grants for
those tables are declared from the code inventory, not found by lint.

## What is deliberately not done yet

Splitting costs network failures, eventual consistency, per-service CI/CD and distributed tracing.
With 9 contexts sharing one database and one deploy, that trade is still a loss — the contexts grew,
the coupling did not. Split when one of these is true, not before:

- a context needs to scale on a different axis (upload is I/O bound, audit is write bound)
- two or more teams block each other on release
- a context needs its own SLA or deploy cadence
- a context needs data isolation for compliance

## Stage 1 — separate runtime, shared database

Cheapest step, fully reversible.

```bash
pnpm gen:app <name>                     # new deployable
# project.json: tags ["scope:<name>", "type:app"]
# eslint.config.mjs: allow-list for scope:<name>
# Dockerfile: new target; docker/compose.*.yml: new service
```

The new app imports the same `libs/modules/src/*` and `libs/infra/src/*`. Webpack's `generatePackageJson`
prunes its dependencies automatically. **No application code changes.**

Gains independent deploy, scaling and blast radius. Does not gain data isolation.

## Stage 2 — separate data for an edge context

`audit-log` and `upload` are the two candidates, because their tables have no inbound foreign key.
`notifications` is a third: it is written only by a listener reacting to `organizations.*` events and
read only by its owner, so it already behaves like a downstream consumer of the event stream.

`api-keys` is explicitly **not** a candidate — verification sits on the authentication path of every
machine request, so moving it across the network buys nothing and adds a hop to every call.

Per context:

1. Move its tables to their own schema/database; give the service its own `DATABASE_URL`.
2. Treat `userId` as a **reference value**, not a foreign key — it already is.
3. Replace the in-process `@OnEvent` subscription with a broker subscription. The relay currently
   dispatches through `EventBusService` (EventEmitter2); publishing to a broker means adding one
   adapter behind `EventPublisherPort` — the port already exists, no call site changes.
4. Keep consumers idempotent. They must be already: the outbox redelivers whenever
   publish succeeds but mark-processed fails.

`DOMAIN_EVENTS` and the per-event payload schemas in each context's `contract` entry point are the
wire contract for this step. They are versioned by `OUTBOX_SCHEMA_VERSION`; the relay refuses
envelopes newer than it understands rather than guessing.

## Stage 3 — separate the core (users/auth)

Most expensive, do last. Better Auth owns `users`, `sessions`, `accounts`, `verifications` and writes
outside the Nest request pipeline; the outbox triggers for `users.*` live on those tables. Extracting
it means:

- every other service receives `userId` and verifies sessions against the identity service
- no cross-context transactions — compensate with sagas driven by the outbox
- the `users.logged_out` / user-cascade interaction (see the trigger SQL) has to be re-derived across
  a service boundary, which is where correctness usually breaks first

## Checklist for extracting one context

- [ ] Context owns its tables and no grant in `table-ownership.map.mjs` points into them
- [ ] Every inbound dependency is an event or an explicit API call, never a shared repository
- [ ] Events it emits are declared in `DOMAIN_EVENTS`, with a payload schema in its `contract`
- [ ] Consumers are idempotent under redelivery
- [ ] Its listeners parse payloads (`safeParse`) instead of casting
- [ ] Health probes split correctly: only core serving deps on `/health/ready`
- [ ] New `scope:*` tag added to `eslint.config.mjs`, boundary test green
- [ ] Prod image boots (`./scripts/build-prod.sh`) — the pruned `package.json` is where extraction
      failures surface first
