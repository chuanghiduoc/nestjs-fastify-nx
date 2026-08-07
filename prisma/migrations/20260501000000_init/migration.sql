CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" UUID NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- Durable ownership and lifecycle state for finalized uploads. `userId` deliberately has no
-- foreign key: the scheduler must still see and delete S3 objects after a user row is purged.
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FINALIZING',
    "failureReason" TEXT,
    -- CLEAN or SKIPPED_TOO_LARGE. Null until verification runs; SKIPPED_TOO_LARGE marks an object
    -- published past ClamAV's 2 GiB scan ceiling, so READY alone never implies it was inspected.
    "scanOutcome" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stored_files_size_check" CHECK ("size" > 0),
    CONSTRAINT "stored_files_status_check" CHECK ("status" IN ('FINALIZING', 'VERIFYING', 'READY', 'REJECTED'))
);

-- `id` is application-stamped UUIDv7 so producers can correlate aggregate
-- writes with the outbox row inside the same transaction.
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Earliest time the relay may re-claim this row after a failed attempt. Stamped by the CLAIM
    -- statement itself (not the error handler) so a relay that dies mid-dispatch still leaves the
    -- row invisible for the backoff window instead of being re-claimed on the very next poll tick.
    "nextAttemptAt" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- Range-partitioned monthly by `createdAt` so retention can drop old months
-- in O(1) instead of streaming DELETEs. Partition key must participate in
-- the PK, hence the composite `(id, createdAt)`.
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "metadata" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- The UNIQUE index on email already serves every lookup path; a second
-- non-unique index would only double write amplification, so it is omitted.
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");
CREATE INDEX "users_status_updatedAt_idx" ON "users"("status", "updatedAt");

-- Pin role/status to their domain enum values at the DB layer.
ALTER TABLE "users" ADD CONSTRAINT "users_role_chk" CHECK ("role" IN ('ADMIN', 'USER'));
ALTER TABLE "users" ADD CONSTRAINT "users_status_chk" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'BANNED'));

-- Trigram indexes back the case-insensitive admin user search (ILIKE '%term%').
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "users_email_trgm_idx" ON "users" USING gin ("email" gin_trgm_ops);
CREATE INDEX "users_name_trgm_idx" ON "users" USING gin ("name" gin_trgm_ops);

CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
-- Backs the scheduler's expired-session purge (SessionCleanupTask). Better Auth never deletes a
-- session row itself, so without this index "WHERE expiresAt < cutoff" degrades into a sequential
-- scan as the table grows unbounded.
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- Better Auth reads "verifications" only by "identifier", ordered by "createdAt" — every
-- password-reset, email-verification and delete-account confirmation takes that path.
-- "expiresAt" backs the scheduler's expired-token purge.
CREATE INDEX "verifications_identifier_createdAt_idx" ON "verifications"("identifier", "createdAt" DESC);
CREATE INDEX "verifications_expiresAt_idx" ON "verifications"("expiresAt");

-- Relay scan path — must come first because (processedAt, createdAt) is the leftmost prefix
-- `WHERE processedAt IS NULL ORDER BY createdAt` uses.
CREATE INDEX "outbox_events_processedAt_createdAt_idx" ON "outbox_events"("processedAt", "createdAt");
-- Backoff-aware claim path: `WHERE processedAt IS NULL AND (nextAttemptAt IS NULL OR
-- nextAttemptAt <= NOW()) ORDER BY createdAt`. The index above cannot serve the added
-- `nextAttemptAt` predicate.
CREATE INDEX "outbox_events_processedAt_nextAttemptAt_createdAt_idx" ON "outbox_events"("processedAt", "nextAttemptAt", "createdAt");
-- Ops debugging path — "show me all undelivered users.registered events".
CREATE INDEX "outbox_events_eventType_processedAt_idx" ON "outbox_events"("eventType", "processedAt");

CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
-- Compliance query path — "every admin action on resource X in window Y".
CREATE INDEX "audit_logs_resource_createdAt_idx" ON "audit_logs"("resource", "createdAt");

CREATE UNIQUE INDEX "stored_files_sourceKey_key" ON "stored_files"("sourceKey");
CREATE UNIQUE INDEX "stored_files_key_key" ON "stored_files"("key");
CREATE INDEX "stored_files_userId_status_idx" ON "stored_files"("userId", "status");
CREATE INDEX "stored_files_status_updatedAt_idx" ON "stored_files"("status", "updatedAt");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotent partition factory called from the scheduler's daily cron and below to seed the
-- initial window. `IF NOT EXISTS` covers concurrent ticks. Runtime scheduler roles must not own
-- application tables, so this runs SECURITY DEFINER with a fixed search_path, scoped to the
-- migration role and revoked from PUBLIC.
CREATE OR REPLACE FUNCTION ensure_audit_log_partition(target_month timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  start_ts timestamptz := date_trunc('month', target_month);
  end_ts   timestamptz := start_ts + INTERVAL '1 month';
  pname    text := 'audit_logs_' || to_char(start_ts AT TIME ZONE 'UTC', 'YYYY_MM');
BEGIN
  -- Target schema must be qualified: `search_path = pg_catalog, public` makes pg_catalog the
  -- current schema for unqualified DDL, and CREATE TABLE there is rejected outright ("permission
  -- denied to create pg_catalog.<partition>... System catalog modifications are currently
  -- disallowed"). Verified by reproduction: an unqualified %I here fails on every call once this
  -- search_path is set, including the seed calls below and the scheduler's monthly cron.
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF "audit_logs" FOR VALUES FROM (%L) TO (%L)',
    pname, start_ts AT TIME ZONE 'UTC', end_ts AT TIME ZONE 'UTC'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_audit_log_partition(timestamptz) FROM PUBLIC;

SELECT ensure_audit_log_partition(NOW() - INTERVAL '1 month');
SELECT ensure_audit_log_partition(NOW());
SELECT ensure_audit_log_partition(NOW() + INTERVAL '1 month');
SELECT ensure_audit_log_partition(NOW() + INTERVAL '2 months');

-- Companion to ensure_audit_log_partition — drops partitions older than a retention cutoff.
-- Same SECURITY DEFINER + fixed search_path + PUBLIC revoke rationale.
CREATE OR REPLACE FUNCTION public.drop_expired_audit_log_partitions(cutoff_month date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  partition_name text;
  partition_month date;
  dropped integer := 0;
BEGIN
  FOR partition_name IN
    SELECT child.relname
      FROM pg_inherits i
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_class child ON child.oid = i.inhrelid
     WHERE parent.relname = 'audit_logs'
       AND child.relname ~ '^audit_logs_[0-9]{4}_(0[1-9]|1[0-2])$'
  LOOP
    partition_month := to_date(substring(partition_name FROM 12), 'YYYY_MM');
    IF partition_month < cutoff_month THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END;
$$;
REVOKE ALL ON FUNCTION public.drop_expired_audit_log_partitions(date) FROM PUBLIC;

-- Atomic transactional outbox triggers. Better Auth commits inserts in its
-- own transaction before any application-side hook fires, so a NestJS hook
-- could lose events on crash. AFTER INSERT/DELETE triggers run inside the
-- same transaction as the source mutation — both rows commit or neither.
-- Payload shape mirrors `OutboxPublisher.serializePayload()` so the relay
-- can reconstruct the in-memory event without a special code path.

CREATE OR REPLACE FUNCTION emit_user_registered_outbox()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "outbox_events" ("id", "eventType", "aggregateId", "payload", "attempts")
  VALUES (
    uuidv7(),
    'users.registered',
    NEW."id"::text,
    jsonb_build_object(
      'schemaVersion', 1,
      'eventId', uuidv7()::text,
      'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'payload', jsonb_build_object('email', NEW."email")
    ),
    0
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_registered_outbox
AFTER INSERT ON "users"
FOR EACH ROW
EXECUTE FUNCTION emit_user_registered_outbox();

CREATE OR REPLACE FUNCTION emit_user_logged_in_outbox()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "outbox_events" ("id", "eventType", "aggregateId", "payload", "attempts")
  VALUES (
    uuidv7(),
    'users.logged_in',
    NEW."userId"::text,
    jsonb_build_object(
      'schemaVersion', 1,
      'eventId', uuidv7()::text,
      'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'payload', jsonb_strip_nulls(jsonb_build_object(
        'sessionId', NEW."id"::text,
        'ip', NEW."ipAddress",
        'userAgent', NEW."userAgent"
      ))
    ),
    0
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_logged_in_outbox
AFTER INSERT ON "sessions"
FOR EACH ROW
EXECUTE FUNCTION emit_user_logged_in_outbox();

-- Stop `users.logged_out` from firing on session rows that nobody logged out of. Two callers
-- delete sessions without a user ever signing out: SessionCleanupTask's nightly expired-session
-- purge, and the `ON DELETE CASCADE` from a hard-deleted user. Two discriminators, both verified
-- against the running database:
--   * `WHEN (OLD."expiresAt" > NOW())` — an already-expired session is garbage being collected,
--     not a sign-out. A genuine sign-out always deletes a still-valid row.
--   * `EXISTS (SELECT 1 FROM users ...)` — inside the child's AFTER DELETE trigger the parent is
--     already gone during a cascade (returns false), while a direct session delete still sees it
--     (returns true). That separates "user deleted" from "user signed out".
-- The WHEN predicate lives on the trigger, not inside the function, so Postgres skips the function
-- call entirely for expired rows — the nightly purge pays no per-row cost.
CREATE OR REPLACE FUNCTION emit_user_logged_out_outbox()
RETURNS TRIGGER AS $$
BEGIN
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

CREATE TRIGGER user_logged_out_outbox
AFTER DELETE ON "sessions"
FOR EACH ROW
WHEN (OLD."expiresAt" > NOW())
EXECUTE FUNCTION emit_user_logged_out_outbox();

-- ─────────────────────────────────────────────────────────────────────────────
-- pg_stat_statements (scaling readiness)
--
-- Requires shared_preload_libraries to load the extension at Postgres startup.
-- CREATE EXTENSION registers it in this database when the library is loaded;
-- silently no-ops with a NOTICE when not loaded (e.g. on managed Postgres
-- providers that pre-enable it differently).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Reset stats on first install for a clean baseline. Wrapped in a DO block
-- so the migration succeeds whether or not the library is pre-loaded:
--   - Library loaded (self-hosted with overlay, or managed PG): reset executes normally.
--   - Library not loaded (stock Postgres, no shared_preload_libraries flag):
--     pg_stat_statements_reset() raises SQLSTATE 55000 (object_not_in_prerequisite_state).
--     We catch ONLY that specific code so real failures (permission errors,
--     missing functions on rolled-back installs, syntax issues) surface and
--     fail the migration as intended. `WHEN OTHERS` would mask them.
DO $$
BEGIN
  PERFORM pg_stat_statements_reset();
EXCEPTION
  WHEN SQLSTATE '55000' THEN
    RAISE NOTICE 'pg_stat_statements not yet active (SQLSTATE: %) — extension registered but stats unavailable until Postgres restarts with shared_preload_libraries=pg_stat_statements configured.', SQLSTATE;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cursor pagination composite index on users
--
-- Repository query:
--   ORDER BY "createdAt" DESC, "id" DESC
--   WHERE ("createdAt", "id") < ($cursorCreatedAt, $cursorId)  -- row-comparison form
--
-- The single-column `users_createdAt_idx` (from the @@index above) covers the
-- ORDER BY on a non-cursor first page but Postgres cannot use it to seek the
-- (createdAt, id) compound predicate — it falls back to filter-after-scan as
-- the table grows, which is exactly the pathology cursor pagination was
-- introduced to avoid. The composite index below makes the seek O(log N) and
-- lets Postgres satisfy the ORDER BY directly from the index without a
-- separate sort step.
--
-- DESC matches the handler's ordering so reverse index scans aren't needed.
-- Idempotent via IF NOT EXISTS so re-runs / branch overlaps are safe.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "users_createdAt_id_desc_idx"
  ON "users" ("createdAt" DESC, "id" DESC);
