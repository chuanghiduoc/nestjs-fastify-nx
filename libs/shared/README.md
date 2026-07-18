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
  generateCorrelationId,
  buildPageMeta,
  paginationSkip,
  type Page,
  type PageMeta,
  type PaginationOptions,
  encodeCursor,
  decodeCursor,
  type DecodedCursor,
  QUEUE_NAMES,
  type QueueName,
  SENSITIVE_REDACT_PATHS,
  SENSITIVE_REDACT_CENSOR,
  ALLOWED_MIME_TYPES,
  MIME_EXTENSIONS,
  detectFileType,
  type DetectedFileType,
  intEnv,
  positiveIntEnv,
  boolEnv,
  injectDatabasePassword,
  STORED_FILE_STATUS,
  type StoredFileStatus,
} from '@nestjs-fastify-nx/shared';
```

| Export                                               | Purpose                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `generateId()`                                       | UUID v7 generator (`uuid@14`) — sortable, time-ordered                                     |
| `generateCorrelationId()`                            | Correlation id for a request/trace chain                                                   |
| `buildPageMeta(page, pageSize, total)`               | Builds a `PageMeta` from page/pageSize + total count                                       |
| `paginationSkip({ page, pageSize })`                 | `(page - 1) * pageSize`, clamped so a bad page can't reach the driver as a negative skip   |
| `Page<T>`, `PageMeta`, `PaginationOptions`           | Pure type aliases for the offset-paginated query contract                                  |
| `encodeCursor(sortField, id)` / `decodeCursor(s)`    | Composite `base64url(iso:id)` cursor — cursor pagination is the default for resource lists |
| `DecodedCursor`                                      | A cursor that has passed validation; repository ports take this, never a raw string        |
| `QUEUE_NAMES` / `QueueName`                          | Single source of truth for BullMQ queue identifiers                                        |
| `SENSITIVE_REDACT_PATHS` / `SENSITIVE_REDACT_CENSOR` | Pino redaction config — drops `cookie` / `authorization` headers                           |
| `ALLOWED_MIME_TYPES`                                 | Upload allow-list, derived from the magic-byte signature table                             |
| `MIME_EXTENSIONS`                                    | mime → canonical extension, derived from the same table so the two cannot drift            |
| `detectFileType(buffer)` / `DetectedFileType`        | Magic-byte sniffing; `null` when no signature matches                                      |
| `intEnv` / `positiveIntEnv` / `boolEnv`              | Typed `process.env` readers with defaults, for code outside Nest's config validation       |
| `injectDatabasePassword(url)`                        | Splices a Docker/K8s secret file into a password-less DB URL                               |
| `STORED_FILE_STATUS` / `StoredFileStatus`            | Upload lifecycle states (`FINALIZING`, `VERIFYING`, `READY`, `REJECTED`)                   |

## Why a separate lib?

Keeping these primitives outside `core` and `infra` means they can be used
inside DTOs (which run on both server and generated clients), inside test
helpers, and inside lightweight scripts (e.g. `scripts/*`) without dragging
NestJS or Prisma along.
