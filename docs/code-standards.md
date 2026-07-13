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

### Domain & Application Violations

Throw `BusinessRuleException` from `@nestjs-fastify-nx/core` for domain violations (duplicate email, insufficient balance, etc.). The global exception filter converts it to a 422 or 409 Problem Details response.

```typescript
if (user.email === email) {
  throw new BusinessRuleException('User already registered with this email', 'duplicate_email');
}
```

### Input Validation

Use `class-validator` decorators on DTOs. The global `ProblemDetailsValidationPipe` automatically converts validation failures to RFC 9457 Problem Details with flat `errors[]` array.

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

**One DTO per shape.** Do not create parallel application + presentation DTOs unless there is a clear reason (e.g., an integration event schema differs from the REST request shape).

```typescript
// libs/modules/users/src/application/dtos/user.dto.ts
export class UserDto {
  id: string;
  email: string;
  name: string;
  role: string;
}

// DO: use UserDto everywhere
// DON'T: create UserApplicationDto and UserPresentationDto unless justified
```

**Re-export from module barrel only what is public.** Keep domain entities and repositories private. Command/query **handlers stay private** — they are registered with the global `CommandBus`/`QueryBus` by `CqrsModule.forRoot()`'s explorer and are never injected directly. Export the **command/query classes + their result types** so composition libs and cross-cutting resolvers can dispatch `commandBus.execute(new SomeCommand(...))` / `queryBus.execute(new SomeQuery(...))`. Queries/commands extend `Query<TResult>`/`Command<TResult>` so `execute()` infers the return type.

```typescript
// libs/modules/users/src/index.ts
export { UsersModule } from './users.module';
export { UserDto } from './application/dtos/user.dto';
// Query class + result type — consumers dispatch via QueryBus, no handler injection.
export {
  GetUserProfileQuery,
  type UserProfileResult,
} from './application/queries/get-user-profile/get-user-profile.query';

// Don't export: User (entity), UserRepository, GetUserProfileHandler (handlers are
// found by the CqrsModule explorer, so they never need to leave the module).
```

## Module Boundaries

**Enforce strict DDD boundaries** via `@nx/enforce-module-boundaries` in `eslint.config.mjs`. Lint errors on imports must be fixed by extracting to a composition lib — never relax the rule.

```typescript
// DO: composition lib aggregates
// libs/composition/admin/src/controllers/admin-users.controller.ts
export class AdminUsersController {
  constructor(
    private readonly usersModule: UsersModule,
    private readonly auditModule: AuditLogModule,
  ) {}
}

// DON'T: direct cross-module imports
// libs/modules/users/src/… → libs/modules/audit-log/src/…
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
| File names     | kebab-case  | `create-user.handler.ts`          |
| Class names    | PascalCase  | `CreateUserHandler`               |
| Function names | camelCase   | `publishUserRegistered()`         |
| JSON keys      | camelCase   | `{ userId: '...', email: '...' }` |
| Error `code`   | snake_case  | `duplicate_email`, `not_found`    |
| HTTP headers   | kebab-case  | `X-Request-Id`, `Content-Type`    |
| Env vars       | UPPER_SNAKE | `AUTH_RATE_LIMIT_MAX`             |

## Comments

**Only WHY comments.** Remove WHAT narration — code reads for itself.

```typescript
// DO: Why
// Retry only transient errors; permanent constraint violations must fail immediately
if (error.code === 'P2002') {
  // Unique constraint
  throw error;
}

// DON'T: What
// Check if error code is P2002
if (error.code === 'P2002') {
  throw error;
}
```

Never reference task IDs, callers, or "added for X" — those belong in PR descriptions.

## Email Job Idempotency

`EmailNotificationProcessor` records successful sends in Redis by `job.id` for 30 days and reuses a deterministic SMTP `Message-ID`. Normal BullMQ redelivery after a completed attempt is therefore suppressed. Raw SMTP is still an at-least-once boundary: a worker crash after the SMTP server accepts a message but before Redis records success can redeliver it. The stable `Message-ID` lets providers and mail clients deduplicate that rare case.

**Consequence for jobId design:** every email job whose `jobId` is reused within 30 days will be silently deduplicated. This is correct for stalled-recovery (same logical send), but wrong if the intent is a genuine re-send triggered by the user.

Rules for producers that call `queue.add('email-notification', payload, { jobId: '...' })`:

- **Single-fire flows** (welcome email, password-reset, verification): use `${purpose}__${event.eventId}` — the outbox eventId is unique per event, so no dedup window applies across separate sends.
- **Resendable flows** (manual "resend verification", ops retrigger): include a timestamp or nonce — e.g. `${templateId}__${to}__${Date.now()}` — so each user-initiated resend produces a distinct jobId and bypasses the SETNX guard.
- **Anti-pattern** (will silently drop resends within 30 days): `${userId}__${type}` with no timestamp. If a user requests two verification emails within that window only the first will be delivered.

## HTTP Idempotency & Request Timeout

Two cross-cutting resilience layers wrap every HTTP request.

**Idempotency-Key (Stripe pattern)** — a Fastify plugin (`register-idempotency.ts`,
wired in `main.ts` before `@fastify/compress`) guards mutating `/api/v1/*` requests
that carry an `Idempotency-Key` header. It runs at the Fastify layer, not as a Nest
interceptor, because `preHandler`/`onSend` have native access to the final status +
serialized body — a Nest interceptor cannot replay the exact response since Nest sets
the status after the interceptor chain.

- First request wins an atomic `SET NX` lock (Redis cache DB 5), runs, and its 2xx
  response is stored and replayed byte-for-byte on retries (`Idempotent-Replayed: true`).
- Concurrent duplicate → `409 idempotency_key_conflict`; key reused with a different
  body (fingerprint = `method + url + body`) → `422 idempotency_key_mismatch`; malformed
  key → `400 idempotency_key_invalid`.
- Scope: the store key hashes the session token (or client IP for anonymous) with the
  key, so principals never read each other's cached response.
- **Fail-open** on a Redis error (mirrors the throttler). Non-2xx responses release the
  lock so the client may retry — safe because command handlers roll their transaction
  back on error, leaving no committed side effect to duplicate.
- **Invariant:** `IDEMPOTENCY_LOCK_TTL_SECONDS * 1000 > HTTP_REQUEST_TIMEOUT_MS` (validated
  on boot) so a finishing request always still owns its lock — preventing a lock-steal.

**Request timeout** — a global `TimeoutInterceptor` (`HTTP_REQUEST_TIMEOUT_MS`, default
30s) aborts a handler that runs too long with `504 request_timeout`. WebSocket handlers
are exempt. Node cannot cancel the orphaned promise, so background work still completes;
the client just stops waiting and the socket is freed. Auth routes (`reply.hijack()`)
bypass the Nest pipeline and are unaffected.

## Read Replica Routing

`PrismaService` exposes two clients: `db` (primary write) and `dbRead` (replica
or alias to `db` when `DATABASE_REPLICA_URL` is unset).

**Rules:**

- `findMany` / `count` / `aggregate` for list endpoints **MUST** use
  `prisma.dbRead`. These reads tolerate the typical 10–50 ms replication lag.
- Single-row PK/UK lookups (`findUnique`/`findFirst` by id or natural key)
  **MUST** use `prisma.db`. A request that writes then reads the same row on
  the same handler (post-signup → `/users/me`) is the rule, not the exception
  — replica lag would surface as 404. Point-lookup cost on primary is
  negligible.
- `exists`-style pre-checks before a write may use `prisma.dbRead`: a
  false-negative on lag is safe because the unique constraint enforces
  correctness at write time.
- Better Auth, outbox relay, and interactive transactions are permanently
  bound to `prisma.db` — do not change these call sites.

## Production Quality

- No half-finished code on main
- No `TODO` comments without a task ID and plan to fix
- No temporary solutions or hacks
- All code paths tested (including error paths)
- All breaking changes documented in `docs/project-changelog.md`
