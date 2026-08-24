# ADR-0001: Multi-tenancy — shared schema, organization-scoped, RLS-enforced

- **Status**: Accepted
- **Date**: 2026-08-19

## Context

The product is B2B SaaS: the paying unit is an organization, users belong to one
or more organizations, and data must never cross between them. The codebase today
implicitly assumes a single tenant — every table, index, cursor, cache key and
rate-limit bucket. Tenancy is the least reversible decision in the system, so it
is decided first.

## Decision

**Shared database, shared schema, `organizationId` column, enforced by Postgres
row-level security.**

### Enforcement is three layers, and the last one is in the database

1. **`PrismaService.withTenantContext()`** — opens the transaction that a
   `SET LOCAL` needs, binds `app.current_org_id` from the CLS request context, and
   **fails closed**: no organization in context throws
   `403 organization_context_required` instead of running unscoped.
2. **Postgres RLS** on every tenant-scoped table, with the request path running as
   a `NOBYPASSRLS` role. This is the layer that actually enforces isolation —
   layer 1 only guarantees the context is present and bound.
3. **Integration tests under a non-superuser role**
   (`*-tenant-isolation.integration.spec.ts`) covering read, write, update, delete
   and post-commit context expiry.

**Rejected: a Prisma Client Extension that auto-injects `organizationId`.** Two
reasons. It cannot be applied to the Better Auth tables — Better Auth queries
`member` by `userId` to list a user's organizations, and an injected
`organizationId` would silently reduce that to the active one. And `$extends`
changes the client's type across the whole codebase, for a layer that is
convenience rather than enforcement: RLS is what makes a missed filter safe.
Repositories therefore scope explicitly, which is also easier to read than an
invisible rewrite.

### RLS coverage is deliberately partial today

Enabled on `stored_files` — the only tenant-owned business table that currently
exists. **Not** enabled on:

- **Better Auth's tables** (`organizations`, `members`, `invitations`, `teams`,
  `team_members`, `organization_roles`). The plugin writes outside the request
  context, so `WITH CHECK` would reject the very first insert of a new
  organization. These are guarded by Better Auth's own membership and permission
  checks on every endpoint.
- **`audit_logs`** — its listener has no organization context yet; enabling RLS
  before that would silently drop audit writes.
- **`outbox_events`** — infrastructure, drained cross-tenant by the relay.
  `organizationId` on the row exists to seed listener context, not to isolate.

**Every new tenant-owned business table MUST enable RLS in the same migration
that creates it.** Partial coverage is a sequencing decision, not a standing
exemption.

### Two Postgres roles, because RLS must not break system work

- `app_request` — RLS enforced. Used by the request path.
- `app_system` — `BYPASSRLS`. Used by the outbox relay, scheduler tasks, health
  probes and migrations, which legitimately operate across tenants.

This extends the existing `docker/postgres/provision-runtime-roles.sh` split
rather than inventing a new mechanism.

### Tenant context propagation

`RequestContextStore` (nestjs-cls, already used for `requestId`/`correlationId`)
gains `organizationId`, `principalType` and `membershipId`. Resolution order:
session `activeOrganizationId` → `X-Organization-Id` header → the organization
bound to the API key. **Membership is verified on every request** — a header is
never trusted. Worker and scheduler seed the same store from
`job.data.organizationId` / the outbox row, mirroring how `correlationId` already
flows.

### `SET LOCAL` requires a transaction — and read replicas must survive it

`SET LOCAL app.current_org_id` only holds inside a transaction, so tenant-scoped
work runs in a unit-of-work transaction. `PrismaService.transaction()` currently
pins every transaction to the primary, which would silently disable the read
replica. It therefore gains a **read-only transaction variant that runs on the
replica**. Keeping the replica is part of this decision, not a later optimisation.

### Consequences for existing mechanisms

| Mechanism        | Required change                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Cursor indexes   | `(organizationId, createdAt DESC, id DESC)`; existing two-column indexes stop serving org-scoped lists |
| Cursor decoding  | Repository always ANDs `organizationId`, otherwise a cursor from org A is usable in org B              |
| Idempotency keys | Principal gains `organizationId`; two orgs must not collide on one key                                 |
| Rate limiting    | Per-organization bucket in addition to per-IP                                                          |
| Outbox           | `outbox_events.organizationId`; listeners seed CLS from it                                             |
| BullMQ           | `job.data.organizationId` mandatory; processors seed CLS                                               |
| Audit log        | `organizationId` + partition key; queryable per organization                                           |
| Prometheus       | **No** `organizationId` label — unbounded cardinality. Tenant identity goes on logs and traces only    |
| WebSocket        | Rooms keyed `org:<id>`; revalidation checks membership, not just session validity                      |

## Consequences

- One migration path, one connection pool, index-efficient queries.
- A single missed filter is a cross-customer data leak, which is why enforcement
  is mechanical and tested rather than reviewed.
- Every tenant-scoped read costs a transaction. This must be measured, not
  assumed: the acceptance bar is **p99 regression ≤ 10%** on list endpoints.
- Room to grow: `Organization.tier` plus an optional dedicated connection string
  lets a large customer move to an isolated database later without touching
  domain code.

## Alternatives rejected

- **Database per tenant.** Operational cost grows linearly with customers, pool
  count explodes, and migrations must be orchestrated across N databases.
  Reachable later for an enterprise "silo" tier.
- **Schema per tenant.** Prisma 7 has no dynamic multi-schema support,
  `migrate deploy` must run per schema, `search_path` conflicts with PgBouncer
  transaction pooling, and the practical ceiling is a few thousand schemas.
- **Application-level filtering only (no RLS).** Rejected: raw SQL bypasses it and
  a single forgotten `where` leaks another customer's data.
