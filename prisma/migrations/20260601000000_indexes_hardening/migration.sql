-- Index hardening pass:
--   1. Drop redundant `users_email_idx` — the UNIQUE index on email already
--      serves every lookup path; the second non-unique index just doubled
--      write amplification.
--   2. Add `outbox_events_eventType_processedAt_idx` for ops debugging queries
--      ("show me all undelivered users.registered events"). The existing
--      `(processedAt, createdAt)` index serves the relay claim path and does
--      not help when filtering by eventType.
--   3. Add `audit_logs_resource_createdAt_idx` for compliance lookups by
--      resource within a time window. Audit retention purge drops whole
--      partitions so per-row indexes do not block O(1) DROP.
--   4. Add a CHECK constraint enforcing min password length at the DB layer.
--      Better Auth applies the same rule in code (minPasswordLength=8) but a
--      direct DB insert (seed scripts, manual ops) could bypass it.
--
-- All operations are idempotent: DROP INDEX IF EXISTS / CREATE INDEX IF NOT
-- EXISTS / ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS.
-- CREATE INDEX CONCURRENTLY cannot run inside the migration transaction
-- wrapper, so we use plain CREATE INDEX — acceptable for these small tables
-- and for an initial bootstrap.

DROP INDEX IF EXISTS "users_email_idx";

CREATE INDEX IF NOT EXISTS "outbox_events_eventType_processedAt_idx"
  ON "outbox_events" ("eventType", "processedAt");

CREATE INDEX IF NOT EXISTS "audit_logs_resource_createdAt_idx"
  ON "audit_logs" ("resource", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_password_min_length_chk'
  ) THEN
    ALTER TABLE "accounts"
      ADD CONSTRAINT "accounts_password_min_length_chk"
      CHECK ("password" IS NULL OR length("password") >= 8);
  END IF;
END
$$;
