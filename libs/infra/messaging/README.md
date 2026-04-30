# infra-messaging

Internal event bus and transactional outbox — the seam between domain events
and durable side-effects (BullMQ jobs, integration events).

**Tag**: `scope:infra`.

## Public API

```ts
import {
  MessagingModule,
  EventBusService,
  OutboxPublisher,
  OutboxRelayService,
  OutboxRelayModule,
} from '@nestjs-fastify-nx/infra-messaging';
```

## Two drivers, one port

Domain code publishes through the `EVENT_PUBLISHER_PORT` token (defined in
`@nestjs-fastify-nx/core`). The implementation behind it is selected at
bootstrap by `EVENT_PUBLISHER_DRIVER`:

| Driver      | Implementation    | Durability                     | Use when                             |
| ----------- | ----------------- | ------------------------------ | ------------------------------------ |
| `inprocess` | `EventBusService` | None (in-memory EventEmitter2) | Dev, single-pod, low-stakes events   |
| `outbox`    | `OutboxPublisher` | Postgres `outbox_events` table | Production, multi-pod, must not lose |

Switching drivers is a config change — no code change in producers or
listeners.

## Outbox flow

```
Aggregate.commit()
  ├── Prisma transaction
  │     ├── insert/update domain row
  │     └── insert outbox_events row (same tx, atomic)
  │
  └── (transaction commits)

OutboxRelayService (in scheduler app)
  ├── poll outbox_events WHERE processedAt IS NULL
  ├── dispatch payload to BullMQ (or HTTP integration target)
  ├── mark processedAt = now()
  └── on failure: increment attempts, retry up to OUTBOX_MAX_ATTEMPTS, then park
```

Tunables (see `docs/environment.md`):

| Variable                  | Default | Purpose                     |
| ------------------------- | ------- | --------------------------- |
| `OUTBOX_POLL_INTERVAL_MS` | `1000`  | Relay polling cadence       |
| `OUTBOX_BATCH_SIZE`       | `50`    | Max events relayed per poll |
| `OUTBOX_MAX_ATTEMPTS`     | `10`    | Retry budget before parking |

## Why the outbox?

A naive `EventEmitter` publish after `prisma.transaction` introduces a
window where the DB commit succeeds but the publish fails (process crashes,
Redis is down, listener throws). The outbox closes that window: the event row
ships in the same transaction as the aggregate change, so either both are
durable or neither is.
