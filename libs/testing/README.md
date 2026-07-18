# testing

Test infrastructure for integration and e2e suites — Testcontainers harness
for real Postgres + Redis, plus a fast database cleaner.

**Tag**: `scope:testing` — may only be imported from test files
(`*.spec.ts`, `*.integration.ts`, `e2e/**`). The lint config exempts those
patterns from production boundary rules.

## Public API

```ts
import {
  createTestContainers,
  type TestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
```

### `createTestContainers()`

Boots ephemeral Postgres 18 and Redis 8 containers and returns the two started
containers plus a `teardown()` hook. It does **not** migrate — call
`deployTestMigrations(databaseUrl)` yourself once the URL is known, or every
query fails with `relation does not exist`. Use it in `beforeAll`; tear down in
`afterAll`.

The containers start sequentially, and the first is stopped if the second fails
to start — a `Promise.all` would leave the survivor running with no handle left
to stop it.

```ts
const containers = await createTestContainers();
const databaseUrl = containers.postgres.getConnectionUri();

process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_CACHE_HOST = containers.redis.getHost();
process.env.REDIS_CACHE_PORT = String(containers.redis.getFirstMappedPort());

deployTestMigrations(databaseUrl);
// ... boot the Nest test module ...
await containers.teardown();
```

### `DatabaseCleaner`

Truncates every table between tests without dropping the schema — orders of
magnitude faster than re-running migrations. Use it in `beforeEach` to
guarantee test isolation:

```ts
const cleaner = new DatabaseCleaner(prismaService);
beforeEach(() => cleaner.truncateAll());
```

## When NOT to mock

Integration and e2e tests in this repo run against the real DB on purpose.
Mocking Prisma was tried and rejected — mocked tests passed while real
migrations failed in production. If a test needs the database, use
Testcontainers via this lib.
