# Architecture

## Monorepo Structure

```
nestjs-fastify-nx/
├── apps/
│   ├── api/          # HTTP + GraphQL + WebSocket entrypoint (NestJS + Fastify)
│   ├── worker/       # BullMQ consumer
│   ├── scheduler/    # Scheduled tasks (@nestjs/schedule)
│   └── migration/    # One-shot prisma migrate deploy + optional seed
├── libs/
│   ├── modules/      # Bounded contexts (DDD)
│   │   ├── users/        # scope:modules — user profile, session lookup
│   │   ├── audit-log/    # scope:modules — domain-event listener writes audit rows
│   │   └── admin/        # scope:composition — cross-context admin surface
│   ├── infra/        # Adapters
│   │   ├── auth/         # Better Auth integration, BetterAuthGuard, RolesGuard
│   │   ├── database/     # Prisma service + module
│   │   ├── redis/        # Cache + Queue modules + DLQ helpers
│   │   ├── messaging/    # Event bus, transactional outbox publisher + relay
│   │   ├── storage/      # S3 / MinIO adapter (StoragePort)
│   │   └── observability/# OpenTelemetry SDK bootstrap, metrics, Sentry init
│   ├── core/         # Cross-cutting: base classes, decorators, errors
│   ├── shared/       # Pure utilities (uuid v7, pagination, queue names)
│   ├── contracts/    # Cross-module DTOs, integration event schemas
│   ├── testing/      # Testcontainers harness + DatabaseCleaner
│   └── api-client/   # Orval-generated REST client (consumed by frontends)
├── prisma/           # schema.prisma, migrations/, seed.mjs
├── docker/           # compose.yml, compose.dev.yml, compose.prod.yml, compose.test.yml
├── scripts/          # build-dev.sh, build-prod.sh, security/*
├── tools/generators/ # Nx generator: @nestjs-fastify-nx/tools-generators:module
└── docs/             # this folder
```

## Domain Module Layout (DDD + Hexagonal)

Each `libs/modules/<context>` follows this structure:

```
module/src/
  domain/
    entities/          # Aggregate roots
    value-objects/     # Immutable VOs
    events/            # Domain events (e.g. UserRegistered)
    ports/             # Interfaces (repository ports, etc.)
  application/
    commands/          # CQRS command handlers
    queries/           # CQRS query handlers
    listeners/         # Domain-event subscribers
    dtos/              # Application-layer transport types
  infrastructure/
    repositories/      # Prisma implementations of domain ports
  presentation/
    controllers/       # HTTP handlers
    dto/               # Request/response DTOs
    decorators/        # Route-scoped decorators (e.g. @CurrentUser)
  module.ts
  index.ts             # Public barrel — re-export only what consumers need
```

Authentication is delegated to [Better Auth](https://better-auth.com) (mounted by
`libs/infra/auth`), so feature modules do not own login/logout flows or token
adapters — they only consume the resulting session via `BetterAuthGuard`.

## Module Boundary Rules

Enforced by `@nx/enforce-module-boundaries` (see `eslint.config.mjs`):

| Source tag          | Allowed dependencies                                             |
| ------------------- | ---------------------------------------------------------------- |
| `scope:api`         | modules, composition, infra, core, shared, contracts             |
| `scope:worker`      | modules, infra, core, shared, contracts                          |
| `scope:scheduler`   | modules, infra, core, shared, contracts                          |
| `scope:migration`   | _(empty — intentional; thin prisma deploy wrapper)_              |
| `scope:composition` | modules, infra, core, shared, contracts                          |
| `scope:modules`     | infra, core, shared, contracts _(NEVER another `scope:modules`)_ |
| `scope:infra`       | infra, core, shared, contracts                                   |
| `scope:core`        | shared                                                           |
| `scope:contracts`   | shared                                                           |
| `scope:testing`     | modules, infra, core, shared, contracts                          |

### Why `scope:composition`?

Bounded contexts must not depend on each other directly — that's the whole
point of DDD isolation. When a feature genuinely needs to combine multiple
contexts (e.g. an admin dashboard that lists users _and_ audit logs), it lives
in a **composition lib** tagged `scope:composition`. Flow is one-way:
composition → modules. A feature module can never import a composition lib.

This is the rule that the `admin` module follows: it imports `UsersModule` and
exposes admin-only routes, but `users` knows nothing about it.

### Test files

`*.spec.ts`, `*.integration.ts`, and `e2e/**/*.ts` are exempt from boundary
rules and may import `scope:testing` (Testcontainers helpers, fixtures).

## Auth Flow

Authentication is handled end-to-end by [Better Auth](https://better-auth.com),
mounted at `/api/auth/*` by `BetterAuthModule` (in `libs/infra/auth`). It owns
the session schema, password hashing (scrypt via `better-auth/crypto`), and
cookie issuance. The full endpoint catalogue is published at
`/api/auth/reference`.

```
POST /api/auth/sign-up/email → Better Auth
  → creates User row + Session row
  → databaseHooks.user.create.after fires
    → publishes UserRegistered domain event via EVENT_PUBLISHER_PORT
    → UserRegisteredListener enqueues EMAIL_NOTIFICATION job (BullMQ)
    → worker process sends the welcome email
  → sets `better-auth.session_token` cookie

POST /api/auth/sign-in/email → Better Auth
  → verifies password, rotates session, sets cookie

POST /api/auth/sign-out → Better Auth
  → invalidates session row, clears cookie

GET /api/v1/users/me → UsersController.getProfile (BetterAuthGuard)
  → guard validates `better-auth.session_token`, attaches user to request
  → GetUserProfileHandler → UserRepository.findById()

GET /api/v1/admin/users → AdminUsersController.list (BetterAuthGuard + RolesGuard)
  → guards reject non-ADMIN sessions with 403
  → ListUsersHandler runs paginated query
```

Protected REST and GraphQL endpoints rely on `BetterAuthGuard` and
`RolesGuard`, both wired globally as `APP_GUARD` providers in `AppModule`.
WebSocket upgrades go through `createWsAuthMiddleware` which validates the
same session cookie — see `apps/api/src/websocket/ws-auth.adapter.ts`.

## API Response Contract

The HTTP surface follows two complementary conventions, both designed so the
frontend can rely on a single rendering path.

### Success — direct (Stripe-style)

Successful 2xx responses return the resource **directly**, with no `{ data, meta }`
envelope:

```json
GET /api/v1/users/me  → 200
{
  "id": "019dd1a5-9235-70db-8d57-54ef901d8185",
  "email": "me@example.com",
  "name": "Me",
  "role": "USER"
}
```

List endpoints wrap items in `ListResponseDto<T>` (Stripe / Linear-style envelope)
— declared via `@ApiPaginatedResponse(ItemDto)` from
`@nestjs-fastify-nx/contracts`:

```json
GET /api/v1/admin/users?limit=20  → 200
{
  "object": "list",
  "url": "/api/v1/admin/users",
  "data": [ … ],
  "hasMore": true,
  "totalCount": 1284,
  "page": 1,
  "perPage": 20
}
```

Cursor pagination is preferred for high-volume endpoints — clients pass
`startingAfter` / `endingBefore` as query params (`CursorPaginationDto`) and
the response omits `page` / `perPage` / `totalCount`.

### Errors — RFC 9457 Problem Details

All error responses (400/401/403/404/409/413/415/422/429/5xx) use
`Content-Type: application/problem+json` with a stable shape:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "One or more fields did not pass validation.",
  "instance": "/api/v1/users",
  "requestId": "019dd1a5-9235-70db-8d57-54ef901d8185",
  "timestamp": "2026-04-30T22:28:27.356Z",
  "errors": [{ "path": "email", "code": "invalid_email", "message": "email must be an email" }]
}
```

- `code` values are **snake_case** stable strings (see `ERROR_CODES` in
  `libs/contracts/src/lib/errors/error-codes.ts`) — frontends use them as i18n
  keys and switch-case discriminators. Override the docs URL via
  `ERROR_DOCS_BASE_URL`.
- `errors[]` is a **flat** list shared by validation (422) and
  `BusinessRuleException` (422/409 — throw from domain/application code).
- `requestId` mirrors the `X-Request-Id` response header — the same id appears
  in pino logs, OpenTelemetry traces, and Sentry events for cross-system
  correlation. The `CorrelationIdMiddleware` accepts an inbound `X-Request-Id`
  or generates a UUID v7.

### Naming conventions

| Surface      | Style      | Example                          |
| ------------ | ---------- | -------------------------------- |
| JSON keys    | camelCase  | `requestId`, `endingAfter`       |
| Error `code` | snake_case | `validation_failed`, `not_found` |
| HTTP headers | kebab-case | `X-Request-Id`, `Content-Type`   |

### Decorators

Controllers wire the contract through three decorators from
`@nestjs-fastify-nx/contracts`:

- `@ApiCommonErrors({ auth, forbidden, notFound, conflict, validation, unsupportedMediaType, payloadTooLarge })`
  — emits `application/problem+json` Swagger responses for the selected codes.
- `@ApiPaginatedResponse(ItemDto)` — composes `ListResponseDto` over the item
  schema via OpenAPI `allOf`.
- `ProblemDetailsValidationPipe` (global, see `apps/api/src/main.ts`) — maps
  `class-validator` failures to the flat `errors[]` shape.

## Eventing

Two event publisher drivers are switchable via `EVENT_PUBLISHER_DRIVER`:

- **`inprocess`** (default) — `EventEmitter2`, in-memory, no durability. Fine
  for dev and single-pod setups.
- **`outbox`** — domain events are written to `outbox_events` in the same
  transaction as the aggregate change; the `OutboxRelayService` (running in
  the scheduler app) polls the table and dispatches durable jobs to BullMQ.
  Provides at-least-once delivery and survives crashes between commit and
  publish.

Listeners are NestJS event subscribers; durable side-effects (email, audit)
always go through BullMQ so retries and dead-letter routing are uniform.

## Spec export & API codegen

`apps/api/src/common/swagger/codegen-app.module.ts` is an HTTP-only variant of
`AppModule` used by `export-spec.ts`. It deliberately drops Socket.io, GraphQL,
Sentry, and metrics to avoid opening Redis sockets and side-effect listeners
during spec generation. When you add a feature module to `AppModule`, mirror
the change in `CodegenAppModule` so the exported OpenAPI spec stays complete.

The codegen pipeline:

```
pnpm codegen:full
  → boots CodegenAppModule
  → SwaggerModule.createDocument writes OpenAPI JSON
  → orval consumes the spec
  → emits typed REST client into libs/api-client
```
