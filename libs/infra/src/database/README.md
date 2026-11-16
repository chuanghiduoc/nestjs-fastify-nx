# database

Prisma 7 integration for the workspace. Owns `PrismaService` (the single
`PrismaClient` instance, transaction propagation through AsyncLocalStorage) and
the `DatabaseModule` that wires it globally.

**Tag**: `scope:infra` — consumed by feature modules' repository adapters in
`libs/modules/src/*/infrastructure/`.

## Repository accessors

Repositories must never call `prisma.db` / `prisma.dbRead` directly:

- `prisma.writeTarget()` — primary, or the ambient interactive transaction when
  one is open. Use it for every write and for point reads a request may perform
  immediately after its own write.
- `prisma.readTarget()` — replica when `DATABASE_REPLICA_URL` is configured,
  otherwise the primary. Use it for list/aggregate reads that tolerate lag.
- `prisma.transaction(fn)` — opens an interactive transaction and propagates it;
  nested calls throw (reuse `prisma.currentTransaction`).
- `prisma.withTenantContext(fn, { readOnly? })` — binds `app.current_org_id` for
  RLS-guarded tables; fails closed when no organization is in CLS.

## Public API

```ts
import {
  DatabaseModule,
  PrismaService,
  type TransactionClient,
  PrismaReplicationLagHealthIndicator,
} from '@nestjs-fastify-nx/infra/database';
```

## Lifecycle

`PrismaService` connects in `onModuleInit` and disconnects in
`onApplicationShutdown` — after the HTTP/WS servers stop accepting work. Moving
the disconnect back to `onModuleDestroy` reintroduces in-flight 500s on every
rolling deploy.

## Driver adapter

Configured with `@prisma/adapter-pg`. Native PostgreSQL 18 features such as
`uuidv7()` work without engine workarounds; the Rust query engine binary is not
shipped. The client is generated into `libs/infra/src/database/generated/prisma`.
