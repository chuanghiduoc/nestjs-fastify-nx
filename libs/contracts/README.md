# contracts

Shared types and DTOs that cross bounded-context boundaries — pagination
envelopes, integration event schemas, public response shapes consumed by both
backend modules and generated clients.

**Tag**: `scope:contracts` — may only depend on `scope:shared`.

## Public API

```ts
import {
  ListResponseDto,
  CursorPaginationDto,
  PaginationDto,
  toListResponse,
  toCursorListResponse,
  toUnpaginatedListResponse,
  invalidCursorProblem,
  fieldProblem,
  ProblemDetailsDto,
  ValidationProblemDetailsDto,
  ValidationErrorItemDto,
  ERROR_CODES,
  ERROR_CATALOG_ENTRIES,
  errorTypeUrl,
  type ErrorCode,
  I18N_KEYS,
  VALIDATOR_CODES,
  ApiCommonErrors,
  type CommonErrorsOptions,
  ApiPaginatedResponse,
  ApiUnpaginatedListResponse,
} from '@nestjs-fastify-nx/contracts';
```

Cursor pagination is the default for resource lists; the offset DTOs exist for the rare screen that
genuinely needs jump-to-page.

| Export                                                | Purpose                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `CursorPaginationDto`                                 | Cursor request DTO (`limit`, `startingAfter`) — the default for lists                     |
| `ListResponseDto<T>`                                  | Stripe-style flat envelope (`object: 'list'`, `url`, `data`, `hasMore`, `lastCursor?`, …) |
| `toCursorListResponse` / `toListResponse`             | Build that envelope from a cursor page / an offset page                                   |
| `toUnpaginatedListResponse`                           | Flat envelope for bounded, non-paginated lists (`hasMore: false`, no offset members)      |
| `PaginationDto`                                       | Offset request DTO (`page`, `pageSize`, capped at 100)                                    |
| `ProblemDetailsDto` / `ValidationProblemDetailsDto`   | RFC 9457 error bodies — the shape the global filter emits                                 |
| `ValidationErrorItemDto`                              | One entry of the flat `errors[]` array                                                    |
| `invalidCursorProblem` / `fieldProblem`               | Builders for `malformed` cursors and field-level domain violations                        |
| `ERROR_CODES` / `ErrorCode` / `ERROR_CATALOG_ENTRIES` | Stable snake_case `code` values + the served documentation catalog                        |
| `errorTypeUrl(code)`                                  | RFC 9457 `type` URI for a code (`/errors/<kebab-code>`)                                   |
| `I18N_KEYS` / `VALIDATOR_CODES`                       | Translation keys and class-validator code mapping                                         |
| `ApiCommonErrors` / `CommonErrorsOptions`             | Documents the error responses a route can emit                                            |
| `ApiPaginatedResponse` / `ApiUnpaginatedListResponse` | Documents a typed 200 for cursor or bounded lists                                         |

The runtime helpers (`buildPageMeta`, `paginationSkip`, type aliases) live in
[`@nestjs-fastify-nx/shared`](../shared/README.md). Use this lib when you need
a serializable contract; use `shared` when you need pure functions.

## Adding integration events

When two bounded contexts need to react to each other, declare the event
schema here (not inside either module). The producer publishes via
`EVENT_PUBLISHER_PORT`; the consumer subscribes via a NestJS listener. The
event payload type imported from `contracts` is the only shared surface —
neither side imports the other's domain code.
