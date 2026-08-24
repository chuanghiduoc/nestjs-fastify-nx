# ADR-0002: Authorization behind a port so PBAC and ReBAC are interchangeable

- **Status**: Accepted
- **Date**: 2026-08-19

## Context

This is a B2B multi-tenant boilerplate whose end domain is unknown. The right
authorization model depends on that domain:

- **PBAC** (roles → permissions, plus scoped grants) fits org / team / resource
  hierarchies with a bounded set of actions. Permission data lives in the same
  Postgres database as the domain, so it can be joined.
- **ReBAC** (Zanzibar-style tuples: `object#relation@subject`) fits deep,
  user-driven sharing graphs — a document inherits from a folder that was shared
  with a team that a user belongs to. Permission data lives in a separate store
  (OpenFGA, SpiceDB) and cannot be joined against domain tables.

Choosing wrong is not fatal; being unable to change the choice is. The forcing
question is therefore not "which model" but **"what has to be true today so that
swapping the model later touches adapters only, never domain or application
code?"**

Three assumptions leak if the port is designed naively, and each one costs a
codebase-wide refactor on the day the engine changes:

1. **List filtering.** A port whose filter method returns a Prisma `where`
   fragment silently assumes permissions are joinable. ReBAC cannot honour it —
   it can only answer `ListObjects` with an array of ids.
2. **Relationship writes.** ReBAC requires a tuple to be written when a resource
   is created (`doc:123#owner@user:42`). PBAC infers the same fact from
   `ownerId`, so it needs no write. A codebase with no write hook has to have one
   threaded through every command handler later.
3. **Consistency.** PBAC decisions are strongly consistent — they are read in the
   same transaction as the domain write. ReBAC is eventually consistent and needs
   a consistency token to avoid a read-after-write miss. A port with no
   consistency parameter cannot express the difference.

## Decision

Authorization is consumed through **one port** owned by `libs/core`. The default
adapter is PBAC on Postgres. The port is shaped so a ReBAC adapter is a drop-in.

### 1. A neutral permission catalog

Permissions are `${ResourceType}:${Action}` constants declared in
`libs/contracts` — a published contract, like `DOMAIN_EVENTS` and `ERROR_CODES`.
Never an ad-hoc string: the value is persisted in role definitions that outlive
any deploy, and each adapter maps the catalog to its own vocabulary (PBAC → a
permission row; ReBAC → a relation on an object type).

### 2. The port

```ts
type PermissionKey = `${ResourceType}:${Action}`;

type Principal =
  | { type: 'user'; userId: string; organizationId: string; membershipId: string }
  | { type: 'api_key'; apiKeyId: string; organizationId: string; scopes: string[] }
  | { type: 'system'; reason: string };

interface ResourceRef {
  type: ResourceType;
  id: string;
  parent?: ResourceRef;
}

type AccessFilter =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'predicate'; where: unknown }
  | { kind: 'ids'; ids: string[]; truncated: boolean };

interface AuthorizationPort {
  check(
    principal: Principal,
    permission: PermissionKey,
    resource?: ResourceRef,
    options?: { consistency?: 'strong' | 'eventual' },
  ): Promise<AccessDecision>;

  checkMany(
    principal: Principal,
    requests: ReadonlyArray<{ permission: PermissionKey; resource?: ResourceRef }>,
  ): Promise<AccessDecision[]>;

  filter(
    principal: Principal,
    permission: PermissionKey,
    resourceType: ResourceType,
  ): Promise<AccessFilter>;

  onResourceCreated(input: {
    actor: Principal;
    resource: ResourceRef;
    relations?: ReadonlyArray<{ relation: string; subject: Principal | ResourceRef }>;
  }): Promise<void>;

  onResourceDeleted(resource: ResourceRef): Promise<void>;

  readonly capabilities: {
    predicateFilter: boolean;
    hierarchy: boolean;
    consistency: 'strong' | 'eventual';
    maxEnumeratedObjects?: number;
  };
}
```

`ResourceRef.parent` carries hierarchy explicitly rather than letting an adapter
infer it. `AccessFilter` is the load-bearing type of this ADR: it is what an
engine can say about a _set_ of resources, and every branch must be handled by
every repository from day one — even while a PBAC adapter only ever produces
`all`, `none` and `predicate`. `onResourceCreated` is a no-op under PBAC, where
the fact is derivable from `ownerId`/`organizationId`; under ReBAC it writes the
tuples that make the resource reachable. `capabilities.predicateFilter` says
whether `filter()` can be expressed as a query condition; `capabilities.hierarchy`
whether `ResourceRef.parent` is understood natively.

### 3. `AccessFilter` is applied by one shared helper

`applyAccessFilter(baseWhere, filter)` lives in `libs/infra/database` and handles
all four branches. Repositories call it; they never branch on `kind` themselves.
This is what makes the swap mechanical: on the day `filter()` starts returning
`ids`, exactly one function changes behaviour and every list endpoint follows.

`truncated: true` means the engine hit `maxEnumeratedObjects` and the answer is
incomplete. It MUST surface as a `DomainException` (kind `conflict`), never as a
silently short page — a truncated permission list that looks like a complete one
is a correctness bug that reads as an empty state.

### 4. Relationship writes go through the outbox when the store is external

`onResourceCreated` is called inside the same `prisma.transaction()` as the
domain write. The PBAC adapter is a no-op, so this is free today. A ReBAC adapter
cannot write atomically to an external store — it writes an outbox row instead
and the relay pushes the tuple (at-least-once; tuple writes are idempotent). This
is the same dual-write discipline the repo already applies to domain events, and
it is the reason the hook must exist before it is needed.

### 5. Conformance suite proves the port, two adapters keep it honest

A single behavioural test suite runs against every adapter. Two adapters ship
from day one — `PostgresPbacAdapter` (production) and `InMemoryAuthorizationAdapter`
(tests) — because a port with one implementation always leaks. An `OpenFgaAdapter`
is "done" when it passes the same suite.

### 6. Entitlement is a separate gate, never merged into permissions

```
allowed = authorization.check(...) AND entitlement.allows(org, feature)
```

Two conditions, two error codes: `403 insufficient_permissions` versus
`403 plan_limit_exceeded` (with an upgrade hint). Merging them makes the client
unable to tell "you may not" from "your plan may not", which is the difference
between a lost click and a lost customer.

## Implementation status

Shipped: the permission catalog (`@nestjs-fastify-nx/shared`), the port and
`applyAccessFilter` (`@nestjs-fastify-nx/core`), `PostgresPbacAdapter` and
`InMemoryAuthorizationAdapter` with `PermissionGuard` / `@RequirePermission`
(`@nestjs-fastify-nx/infra-authorization`), and the conformance suite — the same
16 behavioural tests run against both adapters, which is the evidence for the
swap guarantee below.

Not yet built: the Redis permission cache with a per-organization version counter
(section 6 of ADR-0001's sibling design). Every check currently resolves the
membership and its custom roles from Postgres, which is one or two indexed reads
per request. Add the cache when a measurement — not an intuition — says it is
needed; the port does not change when it arrives.

## Consequences

**What this buys.** Changing engine touches: the adapter, the permission-data
migration, and the admin UI that edits permissions. It does **not** touch domain
entities, command/query handlers, controllers, resolvers, or repositories.

**What it costs today.**

- `filter()` returns a union instead of a `where`, so repositories go through a
  helper rather than spreading a condition inline.
- Every resource-creating command carries one `onResourceCreated` call that does
  nothing under PBAC.
- The permission catalog is an extra indirection over "just check the role".

**What is explicitly NOT abstracted** — the honest limit of this ADR:

- **The permission schema.** Role/grant tables and relation tuples have no common
  shape. Each adapter owns its own tables and migrations.
- **The admin UX.** Editing roles and editing a relation graph are different
  products.
- **The notion of a role.** ReBAC has no first-class role; it is modelled as a
  relation. A migration must translate, and the translation is lossy in both
  directions.

So the guarantee is precisely: **swapping the engine is an adapter rewrite plus a
data migration, not an application rewrite.** Anyone who reads this ADR as
"engines are hot-swappable at runtime" has read it wrong.

**How we would know this was wrong.** If `filter()` starts needing engine-specific
options to stay performant, or if repositories start branching on
`capabilities.*`, the abstraction is leaking and should be re-cut rather than
patched.

**What breaks at scale.** A principal with many overlapping resource grants makes
the PBAC `predicate` an ever-wider `OR`, and the planner will eventually abandon
the index. The threshold is unknown and must be benchmarked at ~10k grants per
organization. The escape hatch is a materialised principal→resource mapping table
behind the same `predicate` branch — no port change.

## Alternatives rejected

- **Commit to PBAC with no port.** Cheapest today, and correct if the domain never
  needs graph sharing. Rejected because the domain is unknown, and retrofitting a
  port after handlers depend on a concrete service is the expensive direction.
- **Adopt OpenFGA/SpiceDB now.** Most expressive, and the right answer for a
  sharing-graph domain. Rejected as the default because it adds a service and a
  datastore to a boilerplate, makes every check a network hop, and turns list
  endpoints into `ListObjects` + `IN (...)`, which degrades exactly where B2B
  tenants grow. Kept reachable via the port.
- **OPA/Rego or Cedar as the policy engine.** Rejected for list filtering: policy
  is evaluated away from the data, so a list endpoint must fetch then filter,
  which breaks cursor pagination and `totalCount`.
- **A free-form condition DSL for ABAC.** Rejected deliberately in favour of a
  finite predicate set (`ownedBy: 'self'`, field matches, team scope). Only a
  finite set can be translated into a query condition; a Turing-complete DSL
  forces fetch-then-filter and re-creates the problem above.
