# infra-redis

Redis modules for cache and queue — two separate Redis instances on different
ports so cache eviction never disrupts queued jobs.

**Tag**: `scope:infra`.

## Public API

```ts
import {
  RedisCacheModule,
  RedisCacheService,
  RedisQueueModule,
  REDIS_QUEUE_CLIENT,
  DeadLetterModule,
  dlqNameFor,
  createDeadLetterRouterClass,
  routeFailedJobToDlq,
  type DeadLetterEnvelope,
} from '@nestjs-fastify-nx/infra-redis';
```

`REDIS_QUEUE_CLIENT` resolves to the ioredis client already connected to the queue instance. Inject
it (`@Inject(REDIS_QUEUE_CLIENT) redis: Redis`) rather than opening a second connection for things
like a processor's SETNX idempotency guard.

## Cache

`RedisCacheModule` wires `cache-manager` over `Keyv` against the cache
instance (`REDIS_CACHE_HOST` / `REDIS_CACHE_PORT`). `RedisCacheService` is a
thin typed wrapper exposing `get` / `set` / `del` / `reset`. `get`, `set` and
`del` take an optional `namespace` that prefixes the key.

Default TTL: `REDIS_CACHE_TTL_MS` (5 minutes).

## Queue

`RedisQueueModule` configures the BullMQ connection against the queue
instance (`REDIS_QUEUE_HOST` / `REDIS_QUEUE_PORT`) with prefix
`REDIS_QUEUE_PREFIX` (`bull` by default). Feature modules declare queues with
`@nestjs/bullmq`'s `BullModule.registerQueue(...)`.

Queue names live in `@nestjs-fastify-nx/shared` (`QUEUE_NAMES`) so producers
and consumers can't drift.

## Dead-letter queues

For at-least-once durability, every business queue gets a paired DLQ. The
naming convention is enforced by `dlqNameFor(queueName)`, which appends `.dlq`.
The separator is a dot, not a colon — BullMQ reserves `:` for its internal Redis
key scheme and rejects it in custom ids.

`createDeadLetterRouterClass(queue)` returns a `QueueEventsHost` subclass already
decorated with `@QueueEventsListener(queue)` — it listens for failures, it is not
a `@Processor`. Register it as a provider:

```ts
@Injectable()
class EmailDeadLetterRouter extends createDeadLetterRouterClass(QUEUE_NAMES.EMAIL_NOTIFICATION) {
  // Jobs that exhaust their retries are auto-routed to email-notification.dlq
}
```

The `DeadLetterEnvelope` type captures the original payload, error, and
attempt history — inspect a DLQ via Bull Board (`/api/admin/queues`).

## Pub/sub for Socket.io

The Socket.io adapter (`@socket.io/redis-adapter`) uses `REDIS_PUBSUB_DB` (DB
index 2 by default on the cache instance) for cross-pod broadcast. That
configuration is wired in `apps/api`, not here — this lib only owns the
client connections.
