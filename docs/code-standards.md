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

**Re-export from module barrel only what is public.** Keep domain entities and repositories private. Command/query handlers and their query types SHOULD also be private by default. Export them from the barrel only when a composition lib or cross-cutting resolver must inject them directly for DI — document each such export with a brief comment explaining why. Prefer `QueryBus.execute(new SomeQuery(...))` over direct handler injection when feasible.

```typescript
// libs/modules/users/src/index.ts
export { UsersModule } from './users.module';
export { UserDto } from './application/dtos/user.dto';
export { CreateUserCommand } from './application/commands/create-user.command';

// Don't export: User (entity), UserRepository, UserEntity
// Only export handlers when a composition lib requires direct DI injection
// (document the reason inline in the barrel).
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

## Production Quality

- No half-finished code on main
- No `TODO` comments without a task ID and plan to fix
- No temporary solutions or hacks
- All code paths tested (including error paths)
- All breaking changes documented in `docs/project-changelog.md`
