# Code Standards

Standards and conventions enforced across the codebase to maintain production quality and developer productivity.

## Logging

**Use nestjs-pino exclusively** via dependency injection. Never use `console.log`, `console.error`, or `console.warn` in application code. Exceptions: one-shot CLI scripts in `apps/migration/` and Webpack/build-time scripts where the NestJS DI container is not available.

```typescript
// DO
constructor(private readonly logger: PinoLogger) {}
this.logger.info('User signed up', { userId: user.id });

// DON'T
console.log('User signed up');
```

Pino logs are structured JSON, correlated with `X-Request-Id`, and automatically included in Sentry events and OpenTelemetry traces.

## Error Handling

### Choosing a status code

The status is part of the API contract — clients branch on it. Pick by what the caller can _do_
about the answer, not by what is nearest to hand. `400` and `500` are not defaults.

| Situation                                                                                           | Status | How                                                                                          |
| --------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Request is malformed — bad JSON, an opaque cursor/token that will not decode, an unparseable header | `400`  | `DomainException({ kind: 'malformed' })`                                                     |
| Body or query failed `class-validator`                                                              | `422`  | Nothing — `ProblemDetailsValidationPipe` owns it                                             |
| Request understood, but a domain rule says no, or the state it references violates policy           | `422`  | `DomainException({ kind: 'validation' })` (its default)                                      |
| No session, or the session expired — re-authenticating would fix it                                 | `401`  | `UnauthorizedException`                                                                      |
| Session is valid, but this principal may not do this — wrong role, deactivated/banned account       | `403`  | `ForbiddenException`                                                                         |
| Resource does not exist — or exists, but the caller must not learn that it does                     | `404`  | `DomainException({ kind: 'not_found' })` / `NotFoundException`                               |
| State conflict a retry could resolve — duplicate key, concurrent update, work still in flight       | `409`  | `DomainException({ kind: 'conflict' })` (use `permanent: false` only when a retry could win) |
| The **request body itself** is over the size limit                                                  | `413`  | Fastify body limit — never hand-rolled                                                       |
| Rate limit hit                                                                                      | `429`  | `@fastify/rate-limit` / `ThrottlerGuard`                                                     |
| A downstream dependency is unreachable or unhealthy (DB, S3, authorization engine)                  | `503`  | `DomainException({ kind: 'unavailable' })` — retryable                                       |
| The server broke for an unknown reason                                                              | `500`  | `InternalServerErrorException`, with no specific `code`                                      |

The three distinctions that actually get chosen wrong:

- **401 vs 403** — ask whether authenticating again would help. It cannot help a banned account, so
  that is `403`. Answering `401` traps any client that reacts to it by redirecting to login: it gets
  a fresh valid session and the very next request `401`s again, forever.
- **400 vs 422** — ask whether the server understood the request. `{"key":"uploads/a.png"}` is
  understood perfectly; refusing it because the stored object is oversized is `422`. A cursor that
  will not base64-decode was never understood at all: `400`.
- **413 describes the request payload**, nothing the request refers to. A 40-byte confirm call that
  names an oversized S3 object is `422` — answering `413` tells the client to shrink the wrong thing.

`5xx` responses carry the generic code for their status. Never attach a specific one: the internal
failure taxonomy is not the client's business.

All `5xx` details are always masked on REST, direct Fastify routes, Better Auth, GraphQL, WebSocket
handshakes, and admin surfaces, regardless of `NODE_ENV`. A `messageKey` does not bypass this rule:
its interpolation arguments are runtime data and therefore are not a security boundary. Local
development is not an exception: database/driver messages
can contain credentials, topology, SQL, table names, or personal data copied from bound values.
Debug through structured logs and Sentry using `requestId`; never make a client response more
verbose to improve developer diagnostics.

Expected database conditions must be translated at the repository/application boundary (for
example, Prisma `P2002` to a domain conflict). The global exception filter is only the final
defense-in-depth layer: it maps a small set of known Prisma codes and turns every other
`PrismaClient*` error into a generic internal failure.

### Error codes

`code` is what clients branch on programmatically. Set it explicitly whenever the caller could
reasonably act differently per cause (`invalid_cursor`, `user_not_found`, `idempotency_key_mismatch`).
Leave it unset when the status alone says everything — the filter then fills in the generic code for
that status (`unauthorized`, `conflict`, …). Codes are `snake_case`; see `ERROR_CODES`.

### Domain & application violations

Throw `DomainException` from `@nestjs-fastify-nx/core` for domain violations. It is a plain `Error`
carrying **no HTTP status** — the same handlers run under REST, GraphQL and the scheduler, so the
transport derives the status from `kind`. Its `errors[]` shape matches validation failures so the
frontend renders both through one path. Full guide: [error-handling.md](./error-handling.md).

```typescript
if (await this.users.exists(email)) {
  throw new DomainException({
    // `kind` is the only decision this layer makes; the filter maps conflict → 409. Pass `title`
    // whenever the kind is not 'validation', because the default title only reads right there.
    kind: 'conflict',
    // A duplicate can disappear before the next attempt, so this one is worth retrying.
    permanent: false,
    title: I18N_KEYS.common.conflict,
    code: ERROR_CODES.USER_ALREADY_EXISTS,
    messageKey: I18N_KEYS.errors.users.already_exists,
    violations: [
      {
        path: 'email',
        code: 'already_exists',
        message: 'That email is already registered',
        messageKey: I18N_KEYS.errors.users.already_exists,
      },
    ],
  });
}
```

Pass `messageKey`/`title` as i18n keys, not literals: `GlobalExceptionFilter` only translates dotted
strings, so a literal silently ships English to every locale.

**Collect a module's exceptions in one file when more than one handler raises the same failure.**
A module with several handlers that each answer `not_found` for the same aggregate ends up with the
same twenty-line literal repeated, and the copies drift. Put small factories in
`<context>-errors.ts` and import them:

```typescript
// libs/modules/src/organizations/application/organization-errors.ts
export const roleInUse = () =>
  conflict(
    'role',
    ERROR_CODES.ORGANIZATION_ROLE_IN_USE,
    'Role is still assigned to at least one member',
    I18N_KEYS.errors.organizations.role_in_use,
  );
```

Keep the exception inline when exactly one handler raises it — a factory with one caller is
indirection without a payoff. Examples: `organization-errors.ts`, `feature-flag-errors.ts`,
`term-errors.ts`.

### Input Validation

Use `class-validator` decorators on DTOs. The global `ProblemDetailsValidationPipe` automatically
converts validation failures to RFC 9457 Problem Details with a flat `errors[]` array. It never
echoes the rejected value; `path`, `rule`, and safe constraint metadata are sufficient for clients.

```typescript
export class CreateUserDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;
}
```

**Never** hand-roll error responses — the global filter owns the shape.

## DTOs

**Application and presentation DTOs are separate, deliberately.** An application DTO is the transport
type a handler returns; a presentation DTO is the HTTP shape. Reusing one for both is what makes the
application layer import `@nestjs/swagger`, and the layering is gone the moment it does — a handler
must stay callable from REST, GraphQL, or a queue consumer without dragging HTTP along.

```typescript
// libs/modules/src/users/application/dto/user-list-item.dto.ts
// Pure TS. No @nestjs/swagger, no class-validator — nothing framework-shaped.
export interface UserListItemDto {
  id: string;
  email: string;
  role: string;
}

// libs/modules/src/users/presentation/dto/auth-response.dto.ts
// Swagger decorators live under presentation/ — this DTO and the controller.
export class UserListItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  role!: string;
}
```

The duplication is the point: it buys the boundary. **Placement rule:**
`class-validator` belongs only in DTO files; `@nestjs/swagger` only in
presentation DTOs and controllers (`<ctx>.dto.ts` / `<ctx>.controller.ts` in a
leaf, `presentation/**` in an engine). Operation files and ports stay
framework-agnostic. Sensitive columns are kept out of responses by
projecting into a purpose-built DTO that simply never declares them — not by `@Exclude`.

**Re-export from module barrel only what is public.** Keep domain entities and repositories private. Command/query **handlers stay private** — they are registered with the global `CommandBus`/`QueryBus` by `CqrsModule.forRoot()`'s explorer and are never injected directly. Export the **command/query classes + their result types** so composition libs and cross-cutting resolvers can dispatch `commandBus.execute(new SomeCommand(...))` / `queryBus.execute(new SomeQuery(...))`. Queries/commands extend `Query<TResult>`/`Command<TResult>` so `execute()` infers the return type.

```typescript
// libs/modules/src/users/index.ts
export { UsersModule } from './users.module';
export type { UserListItemDto } from './application/dto/user-list-item.dto';
// Query class + result type — consumers dispatch via QueryBus, no handler injection.
export {
  GetUserProfileQuery,
  type UserProfileResult,
} from './application/queries/get-user-profile';

// Don't export: User (entity), UserRepository, GetUserProfileHandler (handlers are
// found by the CqrsModule explorer, so they never need to leave the module).
```

## Module Boundaries

**Enforce strict DDD boundaries** via `@nx/enforce-module-boundaries` plus the custom `libs-groups/no-cross-context-imports` rule in `eslint.config.mjs`. The rule forbids every sibling-folder import between contexts in `libs/modules/src/`, and inside `libs/infra/src/` it allows only the documented adapter DAG — `auth → database, i18n`, `authorization → auth, database`, `messaging → database`. In the modules group, a lint error on an import must be fixed by extracting to a composition lib — never relax the rule.

```typescript
// DO: composition lib aggregates
// libs/composition/admin/src/presentation/controllers/admin-users.controller.ts
export class AdminUsersController {
  constructor(
    private readonly usersModule: UsersModule,
    private readonly auditModule: AuditLogModule,
  ) {}
}

// DON'T: direct cross-context imports
// libs/modules/src/users/… → libs/modules/src/audit-log/…
```

See `docs/architecture.md` → Module Boundary Rules for the full dependency matrix.

## Testing

**Ratio: integration > e2e > unit.**

- **Integration**: Test business logic with real Postgres (Testcontainers). This is the primary test type.
- **E2E**: Test full HTTP stacks with Supertest and `createTestApp()`.
- **Unit**: Test pure logic (utilities, value objects) without I/O.

**Never mock the database.** Use Testcontainers (see `libs/testing/src/lib/database-cleaner.ts`).

```typescript
describe('CreateUserHandler', () => {
  let handler: CreateUserHandler;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CreateUserHandler,
        { provide: PrismaService, useValue: TestcontainersPrisma.client },
      ],
    }).compile();

    handler = module.get(CreateUserHandler);
    prisma = module.get(PrismaService);
  });

  it('creates a user and publishes domain event', async () => {
    const result = await handler.execute(new CreateUserCommand('user@example.com', 'password'));
    expect(result.id).toBeDefined();

    // Query real Postgres
    const user = await prisma.user.findUnique({ where: { id: result.id } });
    expect(user.email).toBe('user@example.com');
  });
});
```

## Conventions

| Convention     | Style       | Example                           |
| -------------- | ----------- | --------------------------------- |
| File names     | kebab-case  | `create-user.ts`                  |
| Class names    | PascalCase  | `CreateUserHandler`               |
| Function names | camelCase   | `publishUserRegistered()`         |
| JSON keys      | camelCase   | `{ userId: '...', email: '...' }` |
| Error `code`   | snake_case  | `duplicate_email`, `not_found`    |
| HTTP headers   | kebab-case  | `X-Request-Id`, `Content-Type`    |
| Env vars       | UPPER_SNAKE | `AUTH_RATE_LIMIT_MAX`             |

## Comments

**Zero comments in new code.** Not "few" — zero, including JSDoc and `TODO`. Meaning is carried by naming, small functions, explicit types, and tests. A decision that cannot be expressed that way belongs in `docs/adr/`. Pre-existing comments stay; never run a comment-stripping sweep as a side effect.

## Email Job Idempotency

`EmailNotificationProcessor` records successful sends in Redis by `job.id` for 30 days and reuses a deterministic SMTP `Message-ID`. Normal BullMQ redelivery after a completed attempt is therefore suppressed. Raw SMTP is still an at-least-once boundary: a worker crash after the SMTP server accepts a message but before Redis records success can redeliver it. The stable `Message-ID` lets providers and mail clients deduplicate that rare case.

**Consequence for jobId design:** every email job whose `jobId` is reused within 30 days will be silently deduplicated. This is correct for stalled-recovery (same logical send), but wrong if the intent is a genuine re-send triggered by the user.

Rules for producers that call `queue.add('email-notification', payload, { jobId: '...' })`:

- **Single-fire flows** (welcome email, password-reset, verification): use `${purpose}__${event.eventId}` — the outbox eventId is unique per event, so no dedup window applies across separate sends.
- **Resendable flows** (manual "resend verification", ops retrigger): include a timestamp or nonce — e.g. `${templateId}__${to}__${Date.now()}` — so each user-initiated resend produces a distinct jobId and bypasses the SETNX guard.
- **Anti-pattern** (will silently drop resends within 30 days): `${userId}__${type}` with no timestamp. If a user requests two verification emails within that window only the first will be delivered.

## HTTP Idempotency & Request Timeout

Two cross-cutting resilience layers wrap every HTTP request.

**Idempotency-Key (Stripe pattern)** — `register-idempotency.ts` returns a global Nest
interceptor for authenticated mutating `/api/v1/*` requests. Acquisition and replay run
after authentication and authorization guards on every request, including retries.
A Fastify `onSend` hook, registered before `@fastify/compress`, captures the final status
and uncompressed serialized body for exact replay.

- First request wins an atomic `SET NX` lock (Redis cache DB 5), runs, and its 2xx
  response is stored and replayed byte-for-byte on retries (`Idempotent-Replayed: true`).
- Concurrent duplicate → `409 idempotency_key_conflict`; key reused with a different
  body (fingerprint = `method + url + body`) → `422 idempotency_key_mismatch`; malformed
  key → `400 idempotency_key_invalid`.
- Scope: the store key hashes verified session ID + user ID + active organization, or
  verified API-key ID + organization, together with the client key. Raw credentials and
  IP addresses never select the cache scope. Anonymous writes bypass idempotency.
- **Fail-open** on a Redis error (mirrors the throttler). A **4xx** releases the lock so the
  client may retry — it was rejected before the handler could commit anything. A **5xx keeps
  the record pending until its TTL**, so a retry gets `409` instead: a 500 says nothing about
  whether the mutation committed (a post-commit step, an in-process listener, or the response
  mapping can throw after the write landed), and releasing the lock would invite the retry that
  duplicates it. A `504` is the most visible case of the same uncertainty, not a special one.
- **Invariant:** `IDEMPOTENCY_LOCK_TTL_SECONDS * 1000 > HTTP_REQUEST_TIMEOUT_MS` (validated
  on boot) so a finishing request always still owns its lock — preventing a lock-steal.
- Switching active organizations selects a separate verified cache scope; responses from
  the previous organization are never replayed into the new one.

**Request timeout** — a global `TimeoutInterceptor` (`HTTP_REQUEST_TIMEOUT_MS`, default
30s) aborts a handler that runs too long with `504 request_timeout`. WebSocket handlers
are exempt. Node cannot cancel the orphaned promise, so background work still completes;
the client just stops waiting and the socket is freed. Auth routes (`reply.hijack()`)
bypass the Nest pipeline and are unaffected.

## Read Replica Routing

Repositories resolve their client through the transaction-aware accessors on
`PrismaService`: `writeTarget()` (primary, or the ambient transaction when one is
open) and `readTarget()` (replica when configured, otherwise the primary). Never
call `prisma.db` / `prisma.dbRead` directly from a repository — a direct client
bypasses the AsyncLocalStorage transaction and silently loses outbox atomicity.

**Rules:**

- List/aggregate reads **SHOULD** use `readTarget()`; they tolerate the typical
  10–50 ms replication lag.
- Single-row PK/UK lookups that a request may read immediately after its own
  write **MUST** use `writeTarget()` — replica lag would surface as 404.
- `exists`-style pre-checks before a write may use `readTarget()`: a
  false-negative on lag is safe because the unique constraint enforces
  correctness at write time.
- Better Auth, the outbox relay, and interactive transactions are permanently
  bound to the primary.

## Production Quality

- No half-finished code on main
- No `TODO` comments without a task ID and plan to fix
- No temporary solutions or hacks
- All code paths tested (including error paths)
- All breaking changes documented in `CHANGELOG.md`
