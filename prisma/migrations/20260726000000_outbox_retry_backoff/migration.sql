-- Exponential retry backoff for the outbox relay.
--
-- Before this column the relay re-claimed every failing row on each poll tick
-- (OUTBOX_POLL_INTERVAL_MS, default 1s). A downstream outage lasting only
-- OUTBOX_MAX_ATTEMPTS × poll-interval (10 seconds at the defaults) therefore burned the
-- entire retry budget of every pending event and parked them all as permanently stuck,
-- requiring manual intervention for what was a routine blip.
--
-- `nextAttemptAt` is stamped by the CLAIM statement itself rather than by the error
-- handler, so a relay that dies mid-dispatch still leaves the row invisible for the
-- backoff window instead of being re-claimed immediately.
ALTER TABLE "outbox_events" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- Backoff-aware claim path. The existing (processedAt, createdAt) index cannot serve
-- the added `nextAttemptAt <= NOW()` predicate.
CREATE INDEX "outbox_events_processedAt_nextAttemptAt_createdAt_idx"
    ON "outbox_events"("processedAt", "nextAttemptAt", "createdAt");
