# Domain Module Anatomy

> See [`architecture.md`](./architecture.md) for the system-wide picture (boundary
> rules, eventing, pagination, API contract) and
> [`creating-a-module.md`](./creating-a-module.md) for the generator that
> scaffolds everything described here. This doc explains **what each file in a
> context folder is for**, using the real `libs/modules/src/users`,
> `sessions`, and `api-keys` folders as the examples.

## 1. The tier ladder

A bounded context is a **folder** under `libs/modules/src/<context>/`. The whole
group is ONE Nx project (`modules`) and ONE workspace package; `libs/modules/package.json`
maps `./<ctx>` → `./src/<ctx>/index.ts`, so consumers import
`@nestjs-fastify-nx/modules/<ctx>` and nothing else. There is no per-context
project, package, or tsconfig.

Contexts grow along a **tier ladder**: the leaf tier stays flat; promoting to engine adds the DDD subfolders inside the same context folder (the group project, exports map, and barrels never change).

- **Leaf** (the default, and what `pnpm gen:module` scaffolds): a flat folder
  of ~10-20 files. One colocated operation file per command/query,
  `<ctx>.dto.ts`, `<ctx>.controller.ts`, `<ctx>-repository.port.ts`,
  `prisma-<ctx>.repository.ts` + colocated `.integration.spec.ts`.
- **Engine** (promoted when invariants or listener count force it): the same
  context folder grows the DDD subfolders —
  `domain/{entities,value-objects,ports}/`,
  `application/{commands,queries,listeners,ports,dto}/`,
  `infrastructure/{repositories,dispatchers}/`,
  `presentation/{controllers,dto}/`, `testing/` — while command/query files
  stay **colocated** (one file per operation holding both the class and its
  handler), specs sit next to sources, and `<ctx>.module.ts` /
  `<ctx>-listeners.module.ts` / `index.ts` stay at the context-folder root.
  Current engines: `users`, `organizations`, `api-keys`, `feature-flags`,
  `upload`, `audit-log`.
- **Composition**: `libs/composition/*` — orchestrator-only, still one Nx
  project each. Not part of the group; see [`architecture.md`](./architecture.md).

**Promotion rule**: start a context as a leaf; promote to engine only when
invariants or listener count force it — never preemptively. The leaf keeps
**layers as file roles** (a flat `<ctx>.entity.ts` is "domain", a flat
`create-<ctx>.ts` is "application"); the engine makes those roles explicit
folders, so the same code keeps compiling with only import paths changing.

## 2. What DDD + Hexagonal + CQRS mean here

The four layers map to **file roles** (leaf) or **subfolders** (engine):

- **domain** — `<ctx>.entity.ts`, `*.vo.ts`, `<ctx>-repository.port.ts`:
  business rules and the ports that define persistence contracts. Never
  imports Prisma, Fastify, or `@nestjs/swagger`.
- **application** — colocated operation files (`create-<ctx>.ts`,
  `list-<ctx>.ts`, …) and `*.dispatcher.ts` ports: use cases orchestrated via
  CQRS commands/queries. Framework-agnostic result types live here.
- **infrastructure** — `prisma-<ctx>.repository.ts`, `*.dispatcher.ts`
  implementations: Prisma/BullMQ adapters implementing the ports.
- **presentation** — `<ctx>.controller.ts` and `<ctx>.dto.ts`: HTTP controllers
  and request/response DTOs.

It's "hexagonal" because domain defines **ports** (interfaces) and
infrastructure supplies **adapters**. CQRS (`@nestjs/cqrs`) wires presentation
to application: controllers never call a handler directly, they dispatch a
`Command`/`Query` through a bus, and a colocated `@CommandHandler`/
`@QueryHandler` picks it up.

**Dependency rule**: domain files depend only on framework-agnostic
`core`/`shared` primitives (`ValueObject<T>`, `DomainEvent`, `generateId`) —
never on a framework or infrastructure; operation files depend on domain
(ports, entities, VOs); adapters implement ports; controllers depend on
application and map results to HTTP DTOs. Never sideways from a domain file
into an adapter.

## 3. Request flow

**Read path** — HTTP → QueryBus → handler → repository port → Prisma → DB:

```text
Client → GET /api/v1/users/me
  ▼
UsersController.getProfile()
  │ queryBus.execute(new GetUserProfileQuery(userId))
  ▼
QueryBus (@nestjs/cqrs) ── routes by query class ──┐
  ▼                                                 │
GetUserProfileHandler (@QueryHandler, application/queries/get-user-profile.ts)
  │ @Inject(USER_REPOSITORY_PORT) users              │
  ▼                                                 │
UserRepositoryPort (domain/ports/user-repository.port.ts)  ◄─────┘
  ▲ implements
PrismaUserRepository (infrastructure/repositories/prisma-user.repository.ts)
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

## 4. File types, one by one

### `<ctx>.entity.ts` — aggregate roots

A plain class owning identity and invariants — no decorators, no framework
imports. It's the single place business rules live. Create one per aggregate,
only when invariants demand it (a leaf can start with a plain record type on
the port).

```typescript
// libs/modules/src/users/domain/entities/user.entity.ts
export class User {
  private constructor(private readonly props: UserProps) {}

  static reconstitute(raw: { id: string; email: string; ... }): User {
    return new User({ ...raw, email: Email.fromPersistence(raw.email) });
  }

  get email(): Email { return this.props.email; }
}
```

The private constructor forces every caller through `reconstitute()` — the
repository is the only caller — rather than exposing raw field writes.
`users` has only this one factory: account creation is owned entirely by
Better Auth, so nothing in this module ever mints a brand-new `User`. A
context whose command handlers DO create a new aggregate pairs
`reconstitute()` with a `create()` factory the same way; see
`Team.create()` / `OrganizationRole.create()` in `organizations` for that
shape. No public setters — state changes go through methods, not raw field
writes.

**Rules**: never import Prisma, `@nestjs/swagger`, or `class-validator` here.
Domain enums (`UserRole`, `UserStatus`) live next to the entity and are
re-exported through the barrel for DTOs/GraphQL to reuse.

### `*.vo.ts` — immutable value objects

A wrapper around a primitive that can only exist validly, extending the
shared `ValueObject<T>` base (`libs/core/src/lib/domain/value-object.ts`). It
moves validation out of the entity/DTOs into one place. Create one per domain
concept with its own rule (email, money, slug) — `email.vo.ts` in `users` is
the live example.

```typescript
// libs/modules/src/users/domain/value-objects/email.vo.ts
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

**Rules**: `ValueObject<T>.equals()` compares by value — `isDeepStrictEqual` from
`node:util`, after checking the constructors match — not `===`. Keep VOs
immutable: no mutator methods.

### `<ctx>-repository.port.ts` — repository interfaces

A TypeScript interface plus a DI token (`Symbol`) that infrastructure
implements and application depends on — the hexagonal boundary. Create one
per aggregate needing persistence (or any capability domain must not
implement directly, e.g. `StoragePort`).

```typescript
// libs/modules/src/users/domain/ports/user-repository.port.ts
export const USER_REPOSITORY_PORT = Symbol('USER_REPOSITORY_PORT');

export interface UserRepositoryPort {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAllCursor(options: FindAllCursorOptions): Promise<FindAllCursorResult>;
  save(user: User): Promise<void>;
}
```

Handlers inject it via `@Inject(USER_REPOSITORY_PORT) private readonly users:
UserRepositoryPort` — a `Symbol` token because interfaces don't exist at
runtime. Outbound capabilities with no domain meaning (queue dispatchers,
mailers) get their own port file instead: `upload-verification.dispatcher.ts`
in `upload` is the pattern.

**Rules**: the module binds the token via `{ provide: USER_REPOSITORY_PORT,
useClass: PrismaUserRepository }`. Never inject `PrismaUserRepository` by
class in a handler.

### `create-<ctx>.ts` / `<verb>-<ctx>.ts` — colocated command + handler

A `Command<TResult>` subclass (input) and its `@CommandHandler` (the use case
that mutates state) in ONE file — a single, explicit, named write operation.
Create one file per state-changing use case. `users` has none today (creation
and session lifecycle are fully owned by Better Auth); the shape below is the
scaffold's `create-orders.ts`, structurally identical to
`audit-log`'s `record-audit-log.ts`:

```typescript
// libs/modules/src/orders/create-orders.ts
export class CreateOrdersCommand extends Command<OrdersDto> {
  constructor(readonly input: CreateOrdersInput) {
    super();
  }
}

@CommandHandler(CreateOrdersCommand)
export class CreateOrdersHandler implements ICommandHandler<CreateOrdersCommand, OrdersDto> {
  constructor(@Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepositoryPort) {}

  async execute(command: CreateOrdersCommand): Promise<OrdersDto> {
    const record = {
      id: generateId(),
      ...command.input,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.orders.create(record);
    return record;
  }
}
```

`Command<TResult>` lets `commandBus.execute()` infer the return type
end-to-end. **Why colocated**: the command and its handler change together,
are reviewed together, and are registered together — a separate
`commands/<name>/.command.ts` + `.handler.ts` pair doubles the files without
adding a seam.

**Rules**: handlers are registered with the global bus by
`CqrsModule.forRoot()`'s explorer and must be listed in `providers` — but
**never exported**, and consumers **never inject a handler directly**. Only
`CommandBus`/`QueryBus` cross context boundaries.

### `list-<ctx>.ts` / `get-<ctx>.ts` — colocated query + handler

Same shape as commands, for reads: a `Query<TResult>` subclass plus its
`@QueryHandler`, colocated in one file. Separates read models from write
models. Create one per distinct read use case.

Single-item read (`users/application/queries/get-user-profile.ts`):

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
      // `title` is required for any kind other than 'validation': the default titles itself with a
      // business-rule literal that only reads right there — and a literal is never translated,
      // because the filter only translates dotted i18n keys.
      throw new DomainException({
        kind: 'not_found',
        title: I18N_KEYS.common.not_found,
        code: ERROR_CODES.USER_NOT_FOUND,
        messageKey: I18N_KEYS.errors.users.not_found,
        violations: [...],
      });
    }
    return { id: user.id, email: user.email.toString(), name: user.name, role: user.role, status: user.status, createdAt: user.createdAt, updatedAt: user.updatedAt };
  }
}
```

Cursor-paginated list (`users/application/queries/list-users-cursor.ts`):

```typescript
export interface ListUsersCursorResult {
  data: UserListItemDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export class ListUsersCursorQuery extends Query<ListUsersCursorResult> {
  constructor(
    readonly organizationId: string,
    readonly limit: number,
    readonly options: {
      startingAfter?: string;
      role?: string;
      status?: string;
      search?: string;
    } = {},
  ) {
    super();
  }
}
```

The handler calls `users.findAllCursor(...)`, maps entities to
`UserListItemDto`, and computes `lastCursor` via
`encodeCursor(lastItem.createdAt, lastItem.id)` — see
[`architecture.md`](./architecture.md) for the cursor contract.

**Rules**: domain-not-found is a `DomainException({ kind: 'not_found' })`, never a
raw NestJS `NotFoundException` — the global exception filter maps `kind` to the
status and renders RFC 9457 Problem Details. See [error-handling.md](./error-handling.md).

### Application result types — pure TS (leaf: operation file; engine: `application/dto/`)

A **pure TypeScript interface, no decorators**, declared in the operation
file that produces it (leaf) or in `application/dto/<name>.dto.ts` when
several engine operations share it (`organizations`'
`application/dto/organization-role-application.dto.ts`, `users`'
`application/dto/user-list-item.dto.ts`). Application code must stay
framework-agnostic — the same handler could run from REST, GraphQL, or a
queue consumer.

```typescript
// users/application/dto/user-list-item.dto.ts
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
see the placement table under `<ctx>.dto.ts` below.

### `<ctx>-registered.listener.ts` — domain-event subscribers

An `@Injectable()` class with an `@OnEvent(eventType)` method — a NestJS
event-emitter subscriber, not a CQRS handler. It's where a domain event turns
into a side effect. Create one per event type needing a reaction in this
process.

```typescript
// libs/modules/src/users/application/listeners/user-registered.listener.ts
@Injectable()
export class UserRegisteredListener {
  constructor(@InjectQueue(QUEUE_NAMES.EMAIL_NOTIFICATION) private readonly emailQueue: Queue) {}

  // promisify + suppressErrors:false so a throw propagates to EventBusService.publish — the outbox
  // relay then records lastError and retries. Swallowed here, the event would look delivered.
  @OnEvent('users.registered', { async: true, promisify: true, suppressErrors: false })
  async handle(event: DomainEvent): Promise<void> {
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

### `prisma-<ctx>.repository.ts` — the Prisma adapter

An `@Injectable()` implementing a repository port, talking to Prisma — the
only file in the context importing `@nestjs-fastify-nx/infra-database`. Prisma
types (`Prisma`, model rows) come from that same barrel, not from
`@prisma/client` directly (the Prisma 7 `prisma-client` generator emits into
the database lib and re-exports through its barrel). Create one per
repository port.

```typescript
// libs/modules/src/users/infrastructure/repositories/prisma-user.repository.ts
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
rule. `prisma.writeTarget()` / `readTarget()` also honor an ambient
transaction — see `docs/agent-gotchas.md`.

**Rules**: translate Prisma error codes here (`P2002` → `DomainException` with
`kind: 'conflict'` and the domain `code`; every other Prisma error is re-thrown
for the global filter to mask) so callers never see a raw Prisma
error. This is the only place `User.reconstitute()` runs outside a test
factory.

**Testing**: the adapter's test is the colocated
`prisma-<ctx>.repository.integration.spec.ts` — real Postgres via
Testcontainers, never a mocked `PrismaService`. The group's unit coverage
denominator excludes `prisma-*.repository.ts` files precisely because this
lane, not the unit lane, is the adapter's gate.

### `<ctx>.controller.ts` — HTTP handlers

A `@Controller()` with route methods — the **only** file allowed to inject
`QueryBus`/`CommandBus` and map HTTP concerns onto a dispatch call. Create one
per resource/route group.

```typescript
// libs/modules/src/users/presentation/controllers/users.controller.ts
// No @UseGuards here: BetterAuthGuard and RolesGuard are registered globally as APP_GUARD in
// apps/api. Routes are authenticated by default — @Public() opts out, @Roles() narrows.
// @ApiCookieAuth only documents that; it enforces nothing.
@ApiTags('users')
@Controller('users')
@ApiCookieAuth('session')
export class UsersController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('me')
  @ApiOkResponse({ type: UserProfileResponseDto, description: 'The current user profile.' })
  @ApiCommonErrors({ auth: true, validation: false })
  getProfile(@CurrentUser() user: AuthenticatedSession): Promise<UserProfileResponseDto> {
    return this.queryBus.execute(new GetUserProfileQuery(user.userId));
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
response DTO, not the application result type. Route-scoped param decorators
belong in a shared lib, not the context: use `@CurrentUser()` from
`@nestjs-fastify-nx/infra-auth`, which returns `AuthenticatedSession` and
works for both REST and GraphQL — a per-context copy would duplicate the type
and force every module to re-cast `@Req() req: FastifyRequest & { user } }`.
`AuthenticatedSession` is what `BetterAuthGuard` attaches to the request —
don't confuse it with the `User` entity, and don't redefine it per context.

### `<ctx>.dto.ts` — request/response DTOs

A class with `class-validator` decorators for requests and
`@nestjs/swagger`'s `@ApiProperty` for responses — **the only file in a
context allowed to import `@nestjs/swagger` or `class-validator`** (enforced
by ESLint). Create one per request/response shape.

```typescript
// in sessions.dto.ts
export class ListSessionsFilterDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    description: 'Hide sessions that have already expired. Defaults to true.',
    type: Boolean,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}
```

Extending `CursorPaginationDto` picks up shared `limit`/`startingAfter` query
fields without redeclaring them.

**Which DTO lives where, and why**:

| DTO                        | File role    | Decorators                                 | Reason                                                      |
| -------------------------- | ------------ | ------------------------------------------ | ----------------------------------------------------------- |
| `UserProfileResult`        | application  | none                                       | pure use-case output, reusable from GraphQL/queue consumers |
| `UserListItemDto`          | application  | none                                       | shaped for the query handler, not HTTP                      |
| `UserProfileResponseDto`   | presentation | `@ApiProperty`                             | Swagger contract for `GET /users/me`                        |
| `UserListItemResponseDto`  | presentation | `@ApiProperty`                             | Swagger contract for the admin list item                    |
| `ListUsersCursorFilterDto` | presentation | `class-validator` + `@ApiPropertyOptional` | validates + documents the incoming query string             |

**Rules**: never let `@nestjs/swagger` or `class-validator` leak into an
operation file or a port. If you're importing an application type into a
controller's `@ApiOkResponse`, create the presentation counterpart in
`<ctx>.dto.ts` instead.

### `<ctx>.module.ts` — the module wiring

The `@Module({...})` registering controllers, providers (including the
port→adapter binding), and imports.

```typescript
// libs/modules/src/users/users.module.ts
@Module({
  imports: [UsersListenersModule],
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY_PORT, useClass: PrismaUserRepository },
    // Query handlers registered with the global QueryBus by CqrsModule's explorer;
    // consumers dispatch via QueryBus, so they aren't exported for direct DI.
    GetUserProfileHandler,
    ListUsersCursorHandler,
  ],
})
export class UsersModule {}
```

Importing `UsersListenersModule` (rather than re-declaring `MessagingModule`
/ `RedisQueueModule` / the Bull queue registration here too) pulls in
`UserRegisteredListener` without registering it twice. A module exports a
port token only when another context genuinely needs to inject that
repository directly — nothing does for `users` today, so it exports nothing;
never export a handler, they're found by the CQRS bus explorer purely
because they're in `providers`.

**The `*-listeners.module.ts` split** (`users-listeners.module.ts`) is what
marks a context as an engine:

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

**Rules**: one context folder can never import another (`modules-scale/no-cross-context-imports`).
Cross-context data sharing goes through `scope:composition` or a domain
event.

### `index.ts` — the public barrel

The only file other libs may import from — the group package's exports map
resolves `@nestjs-fastify-nx/modules/users` to it.

```typescript
// libs/modules/src/users/index.ts
export { UsersModule } from './users.module';
export { UsersListenersModule } from './users-listeners.module';
export { UserRole, UserStatus } from './domain/entities/user.entity';

// Queries + result types for cross-cutting consumers (GraphQL, admin composition)
// to dispatch through the QueryBus. Handlers stay internal.
export {
  GetUserProfileQuery,
  type UserProfileResult,
} from './application/queries/get-user-profile';
export {
  ListUsersCursorQuery,
  type ListUsersCursorResult,
} from './application/queries/list-users-cursor';
export type { UserListItemDto } from './application/dto/user-list-item.dto';

export { ListUsersCursorFilterDto } from './presentation/dto/list-users-cursor-filter.dto';
export {
  UserListItemResponseDto,
  UserProfileResponseDto,
} from './presentation/dto/auth-response.dto';
```

**Rules**: export only what a consumer genuinely needs — handlers, the entity
class, and adapter internals stay unexported. Adding to the barrel is
a deliberate API decision.

### `testing/` (engine) or flat `in-memory-*.ts` / `mock-*.ts` (leaf) — fakes and factories

An in-memory repository implementing the same port as the Prisma adapter
(`sessions`' flat `in-memory-session-repository.ts`, `users`'
`testing/mock-user-repository.ts` + `testing/user.factory.ts`). Keeps handler
unit tests fast and DB-free, while the colocated `*.integration.spec.ts`
exercises the real adapter against Testcontainers Postgres.

**Rules**: fakes (like `*.spec.ts`, `*.integration.ts`) are exempt from the
boundary lint rule, but keep them behaviorally faithful — an in-memory
`findAllCursor` replicates the same sort/cursor semantics as Postgres so
handler tests catch real pagination bugs. A fake that always returns
everything turns a tenant-scoping bug into a passing test.

Two mechanical points that cost a CI round trip each when missed:

- **Do not mark a fake's methods `async` unless they `await` something.**
  `@typescript-eslint/require-await` fails the lint step. Return
  `Promise.resolve(value)` instead — the port's signature is unchanged.
- **Generate id and secret fixtures rather than hardcoding them.** A literal
  UUID or `sk_…` string assigned to a name containing `key`/`credential` trips
  the Gitleaks pre-commit hook, and renaming the constant only moves the
  problem. Use `generateId()` / `generateApiKey()` from
  `@nestjs-fastify-nx/shared`.

**Coverage**: the group's threshold is aggregate over the whole of
`libs/modules/src/**`; repository adapters are excluded from the unit
denominator (the integration lane gates them). Cover controllers with
`CommandBus`/`QueryBus` doubles asserting the dispatched message, and handlers
with the in-memory port. Run `pnpm nx test modules -- --coverage` before
pushing — the local target omits the flag.

## 5. Putting it together — adding a feature

Say you're adding "update display name" to `users`. Touch files in order
(new context → run `pnpm gen:module <name>` first; see
[`creating-a-module.md`](./creating-a-module.md)):

1. **`domain/entities/user.entity.ts`** — VO/validation if needed, a method on
   `User` for the invariant, a `UserNameChanged` event if other contexts must
   react.
2. **`domain/ports/user-repository.port.ts`** — extend `UserRepositoryPort`
   only if a new persistence operation is needed (usually `save()` already
   covers updates).
3. **`application/commands/update-user-name.ts`** — colocate
   `UpdateUserNameCommand` + `UpdateUserNameHandler`: load the entity via the
   port, call the domain method, `save()`.
4. **`infrastructure/repositories/prisma-user.repository.ts`** — update the
   adapter if the new field needs mapping.
5. **`presentation/dto/users.dto.ts`** — request DTO (`class-validator`);
   response DTO if the shape changed.
6. **`presentation/controllers/users.controller.ts`** — add the route, inject
   `CommandBus`, dispatch the command.
7. **`users.module.ts`** — register the new handler in `providers`.
8. **`index.ts`** — export the command/result/DTOs only if a composition lib
   or another app needs to dispatch it directly.
9. **`testing/mock-user-repository.ts` / `testing/user.factory.ts`** — extend
   the fake for the new field.
10. **Tests** — unit-test the domain method + handler (in-memory port),
    integration-test the adapter against real Postgres, add/update an e2e
    spec (`apps/api/e2e/`).

Cross-reference [`architecture.md`](./architecture.md) for boundary rules,
the eventing contract, and API conventions, and
[`code-standards.md`](./code-standards.md) for logging/error-handling
conventions inside handlers and repositories.
