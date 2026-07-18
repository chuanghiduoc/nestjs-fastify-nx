# Domain Module Anatomy

> See [`architecture.md`](./architecture.md) for the system-wide picture (boundary
> rules, eventing, pagination, API contract) and
> [`creating-a-module.md`](./creating-a-module.md) for the generator that
> scaffolds everything described here. This doc explains **what each file in a
> module is for**, using the real `libs/modules/users` module as the example.

## 1. What DDD + Hexagonal + CQRS mean here

Every bounded context in `libs/modules/<context>/src/` splits into four
layers: **domain** (business rules), **application** (use cases, orchestrated
via CQRS commands/queries), **infrastructure** (Prisma adapters implementing
domain interfaces), and **presentation** (HTTP controllers + DTOs). It's
"hexagonal" because domain defines **ports** (interfaces) and infrastructure
supplies **adapters** — domain never imports Prisma, Fastify, or
`@nestjs/swagger`. CQRS (`@nestjs/cqrs`) wires presentation to application:
controllers never call a handler directly, they dispatch a `Command`/`Query`
through a bus, and a `@CommandHandler`/`@QueryHandler` picks it up.

**Dependency rule**: domain depends only on framework-agnostic domain/shared
primitives (`ValueObject<T>`, `DomainEvent`, `generateId` from `core`/`shared`) —
never on a framework or infrastructure; application depends on domain (ports,
entities, VOs); infrastructure implements domain ports; presentation depends on
application and maps results to HTTP DTOs. Never sideways from domain into
infrastructure.

## 2. Request flow

**Read path** — HTTP → QueryBus → handler → repository port → Prisma → DB:

```text
Client → GET /api/v1/users/me
  ▼
UsersController.getProfile()
  │ queryBus.execute(new GetUserProfileQuery(userId))
  ▼
QueryBus (@nestjs/cqrs) ── routes by query class ──┐
  ▼                                                 │
GetUserProfileHandler (@QueryHandler)               │
  │ @Inject(USER_REPOSITORY_PORT) users              │
  ▼                                                 │
UserRepositoryPort (domain/ports, interface)  ◄─────┘
  ▲ implements
PrismaUserRepository (infrastructure/repositories)
  │ this.prisma.db.user.findUnique(...)
  ▼
Postgres
```

Commands are identical, with `CommandBus` / `@CommandHandler` instead.

**Event path** — domain event → outbox → relay → listener (NOT the in-memory
`EventBus`):

```text
Postgres AFTER INSERT trigger (same tx as source row)
  ▼
outbox_events table
  ▼
EventBusService.publish() (in-process, default) — OR OutboxRelayService
polls + republishes durably when EVENT_PUBLISHER_DRIVER=outbox
  ▼
UserRegisteredListener.handle()  (@OnEvent('users.registered'))
  │ enqueues a BullMQ job (jobId uses '__' separator, never ':')
  ▼
worker process consumes the job → sends email
```

Domain events never flow through `@nestjs/cqrs`'s in-memory `EventBus` /
`AggregateRoot` — see [`architecture.md#eventing`](./architecture.md) for the
full trigger/outbox/relay contract.

## 3. File types, one by one

### `domain/entities/` — aggregate roots

A plain class owning identity and invariants — no decorators, no framework
imports. It's the single place business rules live. Create one per aggregate
(`user.entity.ts`).

```typescript
// domain/entities/user.entity.ts
export class User {
  private constructor(private readonly props: UserProps) {}

  static create(email: Email, name = ''): User {
    return new User({ id: generateId(), email, name, role: UserRole.USER, ... });
  }

  static reconstitute(raw: { id: string; email: string; ... }): User {
    return new User({ ...raw, email: Email.fromPersistence(raw.email) });
  }

  get email(): Email { return this.props.email; }
  isActive(): boolean { return this.props.status === UserStatus.ACTIVE; }
}
```

The private constructor forces two named factories: `create()` for a
brand-new aggregate, `reconstitute()` for rebuilding from a persisted row (the
repository is the only caller). No public setters — state changes go through
methods, not raw field writes.

**Rules**: never import Prisma, `@nestjs/swagger`, or `class-validator` here.
Domain enums (`UserRole`, `UserStatus`) live next to the entity and are
re-exported through the barrel for DTOs/GraphQL to reuse.

### `domain/value-objects/` — immutable VOs

A wrapper around a primitive that can only exist validly, extending the
shared `ValueObject<T>` base (`libs/core/src/lib/domain/value-object.ts`). It
moves validation out of the entity/DTOs into one place. Create one per domain
concept with its own rule (email, money, slug).

```typescript
// domain/value-objects/email.vo.ts
export class Email extends ValueObject<string> {
  private static readonly REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private constructor(value: string) {
    super(value);
  }

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (!Email.REGEX.test(normalized)) throw new Error(`Invalid email: ${raw}`);
    return new Email(normalized);
  }

  static fromPersistence(raw: string): Email {
    return new Email(raw); // already validated when first written
  }
}
```

`create()` validates untrusted input; `fromPersistence()` trusts a value
already stored in the DB.

**Rules**: `ValueObject<T>.equals()` compares by value (`JSON.stringify`), not
`===`. Keep VOs immutable — no mutator methods.

### `domain/events/` — domain events

A plain class implementing the shared `DomainEvent` interface (`eventId`,
`eventType`, `aggregateId`, `occurredAt`, `payload`). It's the payload shape
carried through the outbox to listeners. Create one per state change other
parts of the system react to.

```typescript
// domain/events/user-registered.event.ts
export interface UserRegisteredPayload extends Record<string, unknown> {
  email: string;
  ip?: string;
  userAgent?: string;
}

export class UserRegistered implements DomainEvent {
  readonly eventId = generateId();
  readonly eventType = 'users.registered';
  readonly occurredAt = new Date();
  constructor(
    readonly aggregateId: string,
    readonly payload: UserRegisteredPayload,
  ) {}
}
```

**Rules**: for `users`, the outbox row is written by a **Postgres trigger**,
not application code (Better Auth writes outside the Nest pipeline). If your
event instead originates from a command handler, publish it via
an outbox write through the same transaction-scoped Prisma client as the
aggregate write. Never call `eventEmitter.emit()` or `queue.add()` directly
from a command handler — anything not written through the outbox is lost on
rollback.

### `domain/ports/` — repository interfaces

A TypeScript interface plus a DI token (`Symbol`) that infrastructure
implements and application depends on — the hexagonal boundary. Create one
per aggregate needing persistence (or any capability domain must not
implement directly, e.g. `StoragePort`).

```typescript
// domain/ports/user-repository.port.ts
export const USER_REPOSITORY_PORT = Symbol('USER_REPOSITORY_PORT');

export interface UserRepositoryPort {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAllCursor(options: FindAllCursorOptions): Promise<FindAllCursorResult>;
  save(user: User): Promise<void>;
  exists(email: string): Promise<boolean>;
}
```

Handlers inject it via `@Inject(USER_REPOSITORY_PORT) private readonly users:
UserRepositoryPort` — a `Symbol` token because interfaces don't exist at
runtime.

**Rules**: the module binds the token via `{ provide: USER_REPOSITORY_PORT,
useClass: PrismaUserRepository }`. Never inject `PrismaUserRepository` by
class in a handler.

### `application/commands/` — command + handler

A `Command<TResult>` subclass (input) paired with an `@CommandHandler` (the
use case that mutates state) — a single, explicit, named write operation.
Create one per state-changing use case. `users` has none today (creation and
session lifecycle are fully owned by Better Auth); the shape below is from
`audit-log`, structurally identical to what a `users` command would look
like:

```typescript
// libs/modules/audit-log/.../record-audit-log.command.ts
export class RecordAuditLogCommand extends Command<void> {
  constructor(
    readonly eventId: string,
    readonly userId: string,
    readonly action: string,
    readonly resource: string,
    readonly metadata: Record<string, unknown>,
    readonly ipAddress: string | null,
    readonly userAgent: string | null,
    readonly occurredAt: Date,
  ) {
    super();
  }
}

// record-audit-log.handler.ts
@CommandHandler(RecordAuditLogCommand)
export class RecordAuditLogHandler implements ICommandHandler<RecordAuditLogCommand, void> {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY_PORT) private readonly repository: AuditLogRepositoryPort,
  ) {}

  async execute(command: RecordAuditLogCommand): Promise<void> {
    const entry = AuditLog.create({ id: command.eventId, ...command });
    await this.repository.append(entry);
  }
}
```

`Command<TResult>` lets `commandBus.execute()` infer the return type
end-to-end.

**Rules**: handlers are registered with the global bus by
`CqrsModule.forRoot()`'s explorer and must be listed in `providers` — but
**never exported**, and consumers **never inject a handler directly**. Only
`CommandBus`/`QueryBus` cross module boundaries.

### `application/queries/` — query + handler

Same shape as commands, for reads: a `Query<TResult>` subclass plus a
`@QueryHandler`. Separates read models from write models. Create one per
distinct read use case.

Single-item read (`get-user-profile/`):

```typescript
export interface UserProfileResult {
  id: string; email: string; name: string; role: UserRole; status: UserStatus;
  createdAt: Date; updatedAt: Date;
}

export class GetUserProfileQuery extends Query<UserProfileResult> {
  constructor(readonly userId: string) { super(); }
}

@QueryHandler(GetUserProfileQuery)
export class GetUserProfileHandler implements IQueryHandler<GetUserProfileQuery, UserProfileResult> {
  constructor(@Inject(USER_REPOSITORY_PORT) private readonly users: UserRepositoryPort) {}

  async execute(query: GetUserProfileQuery): Promise<UserProfileResult> {
    const user = await this.users.findById(query.userId);
    if (!user) {
      throw new BusinessRuleException({ status: HttpStatus.NOT_FOUND, code: 'user_not_found', messageKey: I18N_KEYS.errors.users.not_found, violations: [...] });
    }
    return { id: user.id, email: user.email.toString(), name: user.name, role: user.role, status: user.status, createdAt: user.createdAt, updatedAt: user.updatedAt };
  }
}
```

Cursor-paginated list (`list-users-cursor/`):

```typescript
export interface ListUsersCursorResult {
  data: UserListItemDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export class ListUsersCursorQuery extends Query<ListUsersCursorResult> {
  constructor(
    readonly limit: number,
    readonly startingAfter?: string,
    readonly role?: UserRole,
    readonly status?: UserStatus,
    readonly search?: string,
  ) {
    super();
  }
}
```

The handler calls `users.findAllCursor(...)`, maps entities to
`UserListItemDto`, and computes `lastCursor` via
`encodeCursor(lastItem.createdAt, lastItem.id)` — see
[`architecture.md`](./architecture.md) for the cursor contract.

**Rules**: domain-not-found is a `BusinessRuleException`, never a raw NestJS
`NotFoundException` — that's what the global exception filter maps to RFC
9457 Problem Details.

### `application/dtos/` — application-layer transport types

A **pure TypeScript interface**, no decorators. Application code must stay
framework-agnostic — the same handler could run from REST, GraphQL, or a
queue consumer. Create one whenever a query/command result needs a named,
reusable shape.

```typescript
// application/dtos/user-list-item.dto.ts
export interface UserListItemDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
```

**Rules**: never reuse an application DTO as a controller's response type —
see the placement table under `presentation/dto/` below.

### `application/listeners/` — domain-event subscribers

An `@Injectable()` class with an `@OnEvent(eventType)` method — a NestJS
event-emitter subscriber, not a CQRS handler. It's where a domain event turns
into a side effect. Create one per event type needing a reaction in this
process.

```typescript
// application/listeners/user-registered.listener.ts
@Injectable()
export class UserRegisteredListener {
  constructor(@InjectQueue(QUEUE_NAMES.EMAIL_NOTIFICATION) private readonly emailQueue: Queue) {}

  @OnEvent('users.registered', { async: true })
  async handle(event: UserRegistered): Promise<void> {
    const jobId = `welcome-email__${event.eventId}`; // BullMQ rejects ':' — use '__'
    await this.emailQueue.add(
      'welcome-email',
      {
        to: event.payload.email,
        subject: 'Welcome to the platform!',
        templateId: 'welcome',
        variables: { userId: event.aggregateId, email: event.payload.email },
      },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }
}
```

Using `event.eventId` in the `jobId` makes enqueueing idempotent — BullMQ
dedupes on `jobId`, so outbox redelivery never sends a second email.

**Rules**: `@OnEvent` is driven by `EventBusService`/the outbox relay, unrelated
to `@nestjs/cqrs`'s `EventBus`/`AggregateRoot` (not used for domain events
here). BullMQ custom `jobId`s must never contain `:`.

### `infrastructure/repositories/` — Prisma adapters

An `@Injectable()` implementing a domain port, talking to Prisma — the only
place in the module importing `@nestjs-fastify-nx/infra-database` or
`@prisma/client`. Create one per repository port.

```typescript
// infrastructure/repositories/prisma-user.repository.ts
@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  private mapToEntity(raw: UserRow): User {
    return User.reconstitute({
      id: raw.id,
      name: raw.name,
      email: raw.email,
      role: raw.role as UserRole,
      status: raw.status as UserStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  // Primary (not dbRead) — /users/me reads immediately after sign-up; replica lag would return null.
  async findById(id: string): Promise<User | null> {
    const raw = await this.prisma.db.user.findUnique({ where: { id } });
    return raw ? this.mapToEntity(raw as UserRow) : null;
  }

  async findAllCursor(options: FindAllCursorOptions): Promise<FindAllCursorResult> {
    // builds a Prisma `where`, reads from this.prisma.dbRead (replica-tolerant), take: limit + 1
  }
}
```

`this.prisma.db` (primary) serves `findById`, `findByEmail`, `save`;
`this.prisma.dbRead` (replica, falls back to primary) serves `findAllCursor`,
`exists` — see [`architecture.md`](./architecture.md) for the read-your-writes
rule.

**Rules**: translate Prisma error codes here (`P2002` → `ConflictException`,
unknown → `InternalServerErrorException`) so callers never see a raw Prisma
error. This is the only place `User.reconstitute()` runs outside a test
factory.

### `presentation/controllers/` — HTTP handlers

A `@Controller()` with route methods — the **only** layer allowed to inject
`QueryBus`/`CommandBus` and map HTTP concerns onto a dispatch call. Create one
per resource/route group.

```typescript
// presentation/controllers/users.controller.ts
@ApiTags('users')
@Controller('users')
@UseGuards(BetterAuthGuard)
@ApiCookieAuth('session')
export class UsersController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('me')
  @ApiOkResponse({ type: UserProfileResponseDto, description: 'The current user profile.' })
  @ApiCommonErrors({ auth: true, validation: false })
  getProfile(
    @Req() req: FastifyRequest & { user: AuthenticatedSession },
  ): Promise<UserProfileResponseDto> {
    return this.queryBus.execute(new GetUserProfileQuery(req.user.userId));
  }
}
```

`ListUsersCursorQuery` is dispatched the same way, but from
`AdminUsersController` in the `admin` **composition** lib — listing all users
is admin-only/cross-cutting, while `/users/me` is self-service. This is the
concrete instance of "composition orchestrates, modules own the rule" (see
[`architecture.md`](./architecture.md)).

**Rules**: never inject a handler directly, always the bus. Decorate with
`@ApiCommonErrors` for RFC 9457 Swagger docs. Return the presentation
response DTO, not the application result type.

### `presentation/dto/` — request/response DTOs

A class with `class-validator` decorators for requests and
`@nestjs/swagger`'s `@ApiProperty` for responses — the only layer allowed
HTTP-shape concerns. Create one per request/response shape.

```typescript
// presentation/dto/auth-response.dto.ts
export class UserProfileResponseDto {
  @ApiProperty({ description: 'User UUID v7 identifier.', format: 'uuid' })
  id!: string;
  @ApiProperty({ description: 'User email address.', format: 'email' })
  email!: string;
  // ...role, status, createdAt, updatedAt
}
```

```typescript
// presentation/dto/list-users-cursor-filter.dto.ts
export class ListUsersCursorFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: UserRole, description: 'Filter by role' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Search by name or email (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
```

Extending `CursorPaginationDto` picks up shared `limit`/`startingAfter` query
fields without redeclaring them.

**Which DTO lives where, and why**:

| DTO                        | Layer        | Decorators                                 | Reason                                                      |
| -------------------------- | ------------ | ------------------------------------------ | ----------------------------------------------------------- |
| `UserProfileResult`        | application  | none                                       | pure use-case output, reusable from GraphQL/queue consumers |
| `UserListItemDto`          | application  | none                                       | shaped for the query handler, not HTTP                      |
| `UserProfileResponseDto`   | presentation | `@ApiProperty`                             | Swagger contract for `GET /users/me`                        |
| `UserListItemResponseDto`  | presentation | `@ApiProperty`                             | Swagger contract for the admin list item                    |
| `ListUsersCursorFilterDto` | presentation | `class-validator` + `@ApiPropertyOptional` | validates + documents the incoming query string             |

**Rules**: never let `@nestjs/swagger` or `class-validator` leak into
`application/dtos/`. If you're importing an application DTO into a
controller's `@ApiOkResponse`, create the presentation counterpart instead.

### `presentation/decorators/` & `presentation/types/` — route-scoped helpers

A `createParamDecorator` (e.g. `@CurrentUser()`) plus the type it returns —
centralizes reading the authenticated user off the request.

```typescript
// presentation/decorators/current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: AuthenticatedUser }>();
    return request.user;
  },
);

// presentation/types/authenticated-user.type.ts
export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  sessionId: string;
  sessionToken: string;
}
```

Create one only if a controller needs something off the request beyond
NestJS's built-ins (`@Req`, `@Body`, `@Param`).

**Rules**: `AuthenticatedUser` is presentation-only — what `BetterAuthGuard`
attaches to the request. Don't confuse it with the `User` entity.

### `<context>.module.ts` — the module wiring

The `@Module({...})` registering controllers, providers (including the
port→adapter binding), and imports.

```typescript
// users.module.ts
@Module({
  imports: [
    ConfigModule,
    MessagingModule,
    RedisQueueModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL_NOTIFICATION }),
  ],
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY_PORT, useClass: PrismaUserRepository },
    // Query handlers registered with the global QueryBus by CqrsModule's explorer;
    // consumers dispatch via QueryBus, so they aren't exported for direct DI.
    GetUserProfileHandler,
    ListUsersCursorHandler,
    UserRegisteredListener,
  ],
  exports: [USER_REPOSITORY_PORT],
})
export class UsersModule {}
```

Only the repository port token is exported — never the handlers; they're
found by the CQRS bus explorer purely because they're in `providers`.

**The `*-listeners.module.ts` split** (`users-listeners.module.ts`):

```typescript
// Listeners-only slice for hosts that should not load the HTTP controller
// (e.g. scheduler/worker). Pulls in the same EventEmitter2 instance
// MessagingModule wires up so @OnEvent('users.*') subscriptions receive
// deliveries published by the outbox relay.
@Module({
  imports: [
    MessagingModule,
    RedisQueueModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL_NOTIFICATION }),
  ],
  providers: [UserRegisteredListener],
})
export class UsersListenersModule {}
```

A process like `worker` has no business mounting `UsersController` or its
Swagger metadata, but still needs `UserRegisteredListener` alive to process
`users.registered` events — import this slice instead of the full module.

**Rules**: `scope:modules` libs can never import another `scope:modules` lib
(see [`architecture.md`](./architecture.md)). Cross-module data sharing goes
through `scope:composition` or a domain event.

### `index.ts` — the public barrel

The only file other libs may import from — the Nx path alias
(`@nestjs-fastify-nx/modules-users`) resolves here.

```typescript
export { UsersModule } from './users.module';
export { UsersListenersModule } from './users-listeners.module';
export { UserRole, UserStatus } from './domain/entities/user.entity';

// Queries + result types for cross-cutting consumers (GraphQL, admin composition)
// to dispatch through the QueryBus. Handlers stay internal.
export {
  GetUserProfileQuery,
  type UserProfileResult,
} from './application/queries/get-user-profile/get-user-profile.query';
export {
  ListUsersCursorQuery,
  type ListUsersCursorResult,
} from './application/queries/list-users-cursor/list-users-cursor.query';
export type { UserListItemDto } from './application/dtos/user-list-item.dto';

export { ListUsersCursorFilterDto } from './presentation/dto/list-users-cursor-filter.dto';
export {
  UserListItemResponseDto,
  UserProfileResponseDto,
} from './presentation/dto/auth-response.dto';
```

**Rules**: export only what a consumer genuinely needs — handlers, the entity
class, and infrastructure internals stay unexported. Adding to the barrel is
a deliberate API decision.

### `testing/` — in-memory fakes and factories

A `Mock<Port>Repository` implementing the same domain port as the Prisma
adapter, plus a `<Entity>Factory` for fixtures. Keeps handler unit tests fast
and DB-free, while `*.integration.ts` specs exercise the real adapter against
Testcontainers Postgres.

```typescript
// testing/mock-user-repository.ts
export class MockUserRepository implements UserRepositoryPort {
  private store = new Map<string, User>();
  async findById(id: string): Promise<User | null> { return this.store.get(id) ?? null; }
  async save(user: User): Promise<void> { this.store.set(user.id, user); }
  // findAllCursor / findByEmail / exists mimic Postgres createdAt DESC, id DESC ordering
  clear(): void { this.store.clear(); }
}

// testing/user.factory.ts
export class UserFactory {
  static create(overrides: Partial<{ email: string; name: string; role: UserRole; status: UserStatus }> = {}): User {
    return User.reconstitute({ id: generateId(), email: overrides.email ?? `user${counter}@test.com`, ... });
  }
  static createAdmin(overrides: Partial<{ email: string }> = {}): User {
    return UserFactory.create({ ...overrides, role: UserRole.ADMIN });
  }
}
```

**Rules**: `testing/**` (like `*.spec.ts`, `*.integration.ts`) is exempt from
the module-boundary lint rule, but keep fakes behaviorally faithful —
`MockUserRepository.findAllCursor` replicates the same sort/cursor semantics
as Postgres so handler tests catch real pagination bugs.

## 4. Putting it together — adding a feature

Say you're adding "update display name" to `users`. Touch files in order
(new module → run the generator first; see
[`creating-a-module.md`](./creating-a-module.md)):

1. **`domain/`** — VO/validation if needed, a method on `User` for the
   invariant, a `UserNameChanged` event if other modules must react.
2. **`domain/ports/`** — extend `UserRepositoryPort` only if a new
   persistence operation is needed (usually `save()` already covers updates).
3. **`application/commands/update-user-name/`** — `UpdateUserNameCommand` +
   `UpdateUserNameHandler`: load the entity via the port, call the domain
   method, `save()`.
4. **`infrastructure/repositories/`** — update `PrismaUserRepository` if the
   new field needs mapping.
5. **`presentation/dto/`** — request DTO (`class-validator`); response DTO if
   the shape changed.
6. **`presentation/controllers/`** — add the route, inject `CommandBus`,
   dispatch the command.
7. **`<context>.module.ts`** — register the new handler in `providers`.
8. **`index.ts`** — export the command/result/DTOs only if a composition lib
   or another app needs to dispatch it directly.
9. **`testing/`** — extend the mock repository/factory for the new field.
10. **Tests** — unit-test the domain method + handler (`MockUserRepository`),
    integration-test the repository against real Postgres, add/update an e2e
    spec (`apps/api/e2e/`).

Cross-reference [`architecture.md`](./architecture.md) for boundary rules,
the eventing contract, and API conventions, and
[`code-standards.md`](./code-standards.md) for logging/error-handling
conventions inside handlers and repositories.
