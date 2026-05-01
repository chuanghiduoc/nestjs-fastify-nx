# shared

Framework-agnostic utilities consumed by every layer of the workspace. Pure
functions, constants, and type aliases — no NestJS decorators, no I/O, no
runtime dependencies on the rest of the monorepo.

**Tag**: `scope:shared` — leaf node of the dependency graph; depends on
nothing internal.

## Public API

```ts
import {
  generateId,
  buildPageMeta,
  paginationSkip,
  type Page,
  type PageMeta,
  type PaginationOptions,
  QUEUE_NAMES,
  type QueueName,
  SENSITIVE_REDACT_PATHS,
  SENSITIVE_REDACT_CENSOR,
} from '@nestjs-fastify-nx/shared';
```

| Export                                               | Purpose                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `generateId()`                                       | UUID v7 generator (`uuid@14`) — sortable, time-ordered           |
| `buildPageMeta(page, pageSize, total)`               | Builds a `PageMeta` from page/pageSize + total count             |
| `paginationSkip({ page, pageSize })`                 | `(page - 1) * pageSize`, clamped to safe values                  |
| `Page<T>`, `PageMeta`, `PaginationOptions`           | Pure type aliases for the paginated query contract               |
| `QUEUE_NAMES` / `QueueName`                          | Single source of truth for BullMQ queue identifiers              |
| `SENSITIVE_REDACT_PATHS` / `SENSITIVE_REDACT_CENSOR` | Pino redaction config — drops `cookie` / `authorization` headers |

## Why a separate lib?

Keeping these primitives outside `core` and `infra` means they can be used
inside DTOs (which run on both server and generated clients), inside test
helpers, and inside lightweight scripts (e.g. `scripts/*`) without dragging
NestJS or Prisma along.
