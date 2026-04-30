# infra-database

Prisma 7 integration for the workspace. Owns the `PrismaService` (extends
`PrismaClient` with NestJS lifecycle hooks) and the `DatabaseModule` that wires
it as a global provider.

**Tag**: `scope:infra` — consumed by feature modules' repository adapters in
`libs/modules/*/src/infrastructure/`.

## Public API

```ts
import { DatabaseModule, PrismaService } from '@nestjs-fastify-nx/infra-database';
```

| Export           | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `DatabaseModule` | Global NestJS module — exports `PrismaService` workspace-wide |
| `PrismaService`  | `PrismaClient` subclass with `onModuleInit` connect logic     |

## Driver adapter

The `PrismaService` is configured with `@prisma/adapter-pg`, which routes
queries through `node-postgres` instead of Prisma's bundled query engine.
Trade-offs:

- **Pro**: smaller container image, predictable pool behaviour, full access to
  `pg_stat_activity` (set `DATABASE_APPLICATION_NAME` to identify connections)
- **Pro**: native PostgreSQL 18 features like `uuidv7()` work without engine
  workarounds
- **Con**: requires `previewFeatures = ["driverAdapters"]` in `schema.prisma`

## Pool tuning

All pool settings come from environment variables (see
[`docs/environment.md`](../../../docs/environment.md)):

| Variable                         | Default | Notes                                 |
| -------------------------------- | ------- | ------------------------------------- |
| `DATABASE_POOL_MAX`              | `20`    | Max concurrent connections            |
| `DATABASE_POOL_MIN`              | `0`     | Idle floor (0 lets pg-bouncer manage) |
| `DATABASE_IDLE_TIMEOUT_MS`       | `10000` | Recycle idle connections              |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `5000`  | Acquire timeout — fail fast           |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | `30000` | Per-statement timeout                 |

## Repository pattern

Feature modules declare a port (`UserRepositoryPort`) in their `domain/ports/`
folder and implement it under `infrastructure/repositories/`. The Prisma
implementation imports `PrismaService` from this lib and translates between
domain entities and Prisma rows. Domain code never imports Prisma directly.
