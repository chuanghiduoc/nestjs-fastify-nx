# contracts

Shared types and DTOs that cross bounded-context boundaries — pagination
envelopes, integration event schemas, public response shapes consumed by both
backend modules and generated clients.

**Tag**: `scope:contracts` — may only depend on `scope:shared`.

## Public API

```ts
import { PaginationDto, PageMetaDto, PageDto } from '@nestjs-fastify-nx/contracts';
```

| Export          | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `PaginationDto` | `class-validator`-decorated request DTO (`page`, `limit`)  |
| `PageMetaDto`   | Response metadata (`total`, `page`, `limit`, `totalPages`) |
| `PageDto<T>`    | Generic paginated response envelope (`items`, `meta`)      |

The runtime helpers (`buildPageMeta`, `paginationSkip`, type aliases) live in
[`@nestjs-fastify-nx/shared`](../shared/README.md). Use this lib when you need
a serializable contract; use `shared` when you need pure functions.

## Adding integration events

When two bounded contexts need to react to each other, declare the event
schema here (not inside either module). The producer publishes via
`EVENT_PUBLISHER_PORT`; the consumer subscribes via a NestJS listener. The
event payload type imported from `contracts` is the only shared surface —
neither side imports the other's domain code.
