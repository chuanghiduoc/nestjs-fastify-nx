-- Stop `users.logged_out` from firing on session rows that nobody logged out of.
--
-- The trigger was `AFTER DELETE ON sessions FOR EACH ROW` with no predicate, so it
-- treated EVERY session deletion as a sign-out. Two callers delete sessions without a
-- user ever signing out:
--
--   1. SessionCleanupTask (scheduler, 03:30 UTC) batch-deletes sessions whose
--      `expiresAt` is already past — Better Auth never reaps them itself. At the
--      defaults that is SESSION_PURGE_BATCH_SIZE x SESSION_PURGE_MAX_BATCHES =
--      200,000 rows per run, so one nightly purge could inject 200,000 fabricated
--      logout events.
--
--   2. `ON DELETE CASCADE` from `sessions.userId`. CleanupTask.purgeInactiveUsers
--      hard-deletes inactive users, cascading into their sessions — emitting logout
--      events whose `aggregateId` points at a user row that no longer exists.
--
-- The blast radius is larger than log noise. The relay claims strictly
-- `ORDER BY "createdAt", id` at OUTBOX_BATCH_SIZE (50) per OUTBOX_POLL_INTERVAL_MS
-- (1s), so 200,000 garbage rows are ~66 minutes of head-of-line blocking: a real
-- `users.registered` created at 03:31 waits behind all of them, and its welcome email
-- is delayed by the length of the backlog. Every one of those events also reaches
-- AuditLogListener's `users.*` subscription, writing a matching audit_logs row.
--
-- Two discriminators, both verified against the running database:
--   * `WHEN (OLD."expiresAt" > NOW())` — an already-expired session is garbage being
--     collected. A user cannot log out of a session that had stopped authenticating
--     them. A genuine sign-out always deletes a still-valid row.
--   * `EXISTS (SELECT 1 FROM users ...)` — inside the child's AFTER DELETE trigger the
--     parent is already gone during a cascade (returns false), while a direct session
--     delete still sees it (returns true). That separates "user deleted" from
--     "user signed out".

CREATE OR REPLACE FUNCTION emit_user_logged_out_outbox()
RETURNS TRIGGER AS $$
BEGIN
  -- Cascade from a user hard-delete, not a sign-out. Attributing a logout to an
  -- aggregate that no longer exists produces an event no consumer can act on.
  IF NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = OLD."userId") THEN
    RETURN OLD;
  END IF;

  INSERT INTO "outbox_events" ("id", "eventType", "aggregateId", "payload", "attempts")
  VALUES (
    uuidv7(),
    'users.logged_out',
    OLD."userId"::text,
    jsonb_build_object(
      'schemaVersion', 1,
      'eventId', uuidv7()::text,
      'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'payload', jsonb_strip_nulls(jsonb_build_object(
        'tokenId', OLD."id"::text,
        'ip', OLD."ipAddress",
        'userAgent', OLD."userAgent",
        'sessionExpiresAt', to_char(OLD."expiresAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ))
    ),
    0
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- The WHEN predicate is on the trigger, not inside the function, so Postgres skips the
-- function call entirely for expired rows — the nightly purge pays no per-row cost.
DROP TRIGGER IF EXISTS user_logged_out_outbox ON "sessions";
CREATE TRIGGER user_logged_out_outbox
AFTER DELETE ON "sessions"
FOR EACH ROW
WHEN (OLD."expiresAt" > NOW())
EXECUTE FUNCTION emit_user_logged_out_outbox();
