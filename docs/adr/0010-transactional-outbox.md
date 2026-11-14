# ADR-0010: Transactional outbox and relay semantics

- **Status**: Accepted
- **Date**: 2026-11-15

## Context

Domain events must survive a transaction rollback and a process crash. In-process
`EventEmitter2` publishes are lost when the enclosing transaction rolls back, and
a queue publish issued from a command handler has the same dual-write problem.
Two producer shapes exist in this repo: Postgres triggers on the source tables and
application publishing through `OutboxPublisher` when the actor is only known in
the application layer.

## Decision

1. **Every domain event lands in `outbox_events` atomically with its business
   write.** Trigger-produced events run in the source row's transaction by
   construction. Application-produced events call `OutboxPublisher.publish()` /
   `publishAll()` inside `prisma.transaction()`; outside a transaction the
   publisher throws unless the caller opts into `{ eventOnly: true }`.
2. **The relay uses three stages:** claim (`FOR UPDATE SKIP LOCKED`, short
   transaction), publish (outside any transaction), mark processed (per row).
   Backoff is stamped by the claim statement itself so a relay crash mid-dispatch
   leaves the row invisible for the backoff window.
3. **At-least-once delivery; consumers are idempotent by design.** Notification and
   audit rows derive their primary key from the outbox `eventId`; BullMQ jobs use a
   deterministic `jobId`. A publish succeeded / mark failed crash therefore
   redelivers, and the consumer no-ops.
4. **Failures classify by permanence.** A `DomainException` with `permanent: true`
   parks the row immediately (`attempts = maxAttempts`). Transient failures back
   off exponentially up to `OUTBOX_MAX_ATTEMPTS`. A dispatch is bounded by
   `OUTBOX_DISPATCH_TIMEOUT_MS` so one hung listener cannot wedge the single
   drainer.
5. **Schema-version skew parks loudly and re-drives on upgrade.** A row whose
   envelope version exceeds the relay's is parked with an explanatory `lastError`;
   the relay resets those attempts on startup after a deploy so they are retried
   once the consumer catches up.
6. **A single leader drains.** The scheduler holds a Redis lease; `SKIP LOCKED`
   keeps a split-brain window at-least-once-safe rather than exactly-once.

## Consequences

- Producers cannot publish outside a transaction by accident.
- Ordering is guaranteed only within one claim batch per aggregate; consumers must
  tolerate per-aggregate reordering under failure.
- Parked rows are operationally visible through the stuck-row warning and the
  runbook replay procedure; they are deleted after the parked-retention window.
- Tests must exercise the claim SQL against real Postgres (an integration spec
  seeds `outbox_events` and drives `relay.tick()`), and publisher atomicity with a
  forced rollback.
