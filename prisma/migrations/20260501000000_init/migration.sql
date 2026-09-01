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
    "activeOrganizationId" UUID,
    "activeTeamId" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- Better Auth scopes account identity by `issuer` rather than `providerId`: credential accounts
-- get `local:credential`, an OAuth provider without an issuer of its own gets `local:oauth:<id>`.
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "accountId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
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

CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "teamId" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inviterId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_status_check" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'canceled'))
);

CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_roles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "organization_roles_pkey" PRIMARY KEY ("id")
);

-- Durable ownership and lifecycle state for finalized uploads. `userId` deliberately has no
-- foreign key: the scheduler must still see and delete S3 objects after a user row is purged.
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
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
    "deletedAt" TIMESTAMP(3),
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
    "organizationId" UUID,
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
    "organizationId" UUID,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "metadata" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- Machine-to-machine credential. Only the SHA-256 digest of the raw key is stored — the raw value
-- is returned once at creation and is unrecoverable afterwards. `prefix` is the non-secret
-- fragment the UI lists so an operator can tell two keys apart without seeing either secret.
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "createdById" UUID,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Scoped to one organization by design: a nullable organizationId would need a partial unique
-- index to keep a single global row per key, which Prisma cannot declare (see ADR-0004).
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_flags_rollout_check" CHECK ("rolloutPercentage" BETWEEN 0 AND 100)
);

-- Platform-wide legal documents. Not tenant-scoped: every organization is served the same
-- published version, and acceptance is recorded per user.
CREATE TABLE "terms" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "term_acceptances" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "termId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "term_acceptances_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "sessions_activeOrganizationId_idx" ON "sessions"("activeOrganizationId");
CREATE INDEX "sessions_activeTeamId_idx" ON "sessions"("activeTeamId");
-- Backs the scheduler's expired-session purge (SessionCleanupTask). Better Auth never deletes a
-- session row itself, so without this index "WHERE expiresAt < cutoff" degrades into a sequential
-- scan as the table grows unbounded.
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

CREATE UNIQUE INDEX "accounts_issuer_accountId_key" ON "accounts"("issuer", "accountId");
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- Better Auth reads "verifications" only by "identifier", ordered by "createdAt" — every
-- password-reset, email-verification and delete-account confirmation takes that path.
-- "expiresAt" backs the scheduler's expired-token purge.
CREATE INDEX "verifications_identifier_createdAt_idx" ON "verifications"("identifier", "createdAt" DESC);
CREATE INDEX "verifications_expiresAt_idx" ON "verifications"("expiresAt");

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_createdAt_id_desc_idx" ON "organizations"("createdAt" DESC, "id" DESC);

CREATE UNIQUE INDEX "members_organizationId_userId_key" ON "members"("organizationId", "userId");
CREATE INDEX "members_userId_idx" ON "members"("userId");
CREATE INDEX "members_org_createdAt_id_desc_idx" ON "members"("organizationId", "createdAt" DESC, "id" DESC);

CREATE INDEX "invitations_organizationId_status_idx" ON "invitations"("organizationId", "status");
CREATE INDEX "invitations_email_status_idx" ON "invitations"("email", "status");
CREATE INDEX "invitations_expiresAt_idx" ON "invitations"("expiresAt");
CREATE INDEX "invitations_inviterId_idx" ON "invitations"("inviterId");
CREATE INDEX "invitations_teamId_idx" ON "invitations"("teamId");

CREATE UNIQUE INDEX "teams_organizationId_name_key" ON "teams"("organizationId", "name");
CREATE INDEX "teams_org_createdAt_id_desc_idx" ON "teams"("organizationId", "createdAt" DESC, "id" DESC);

CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");
CREATE INDEX "team_members_userId_idx" ON "team_members"("userId");

CREATE UNIQUE INDEX "organization_roles_organizationId_role_key" ON "organization_roles"("organizationId", "role");

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
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt" DESC);

CREATE UNIQUE INDEX "stored_files_sourceKey_key" ON "stored_files"("sourceKey");
CREATE UNIQUE INDEX "stored_files_key_key" ON "stored_files"("key");
CREATE INDEX "stored_files_userId_status_idx" ON "stored_files"("userId", "status");
CREATE INDEX "stored_files_status_updatedAt_idx" ON "stored_files"("status", "updatedAt");
CREATE INDEX "stored_files_organizationId_status_idx" ON "stored_files"("organizationId", "status");
CREATE INDEX "stored_files_org_createdAt_id_desc_idx" ON "stored_files"("organizationId", "createdAt" DESC, "id" DESC);
CREATE INDEX "stored_files_deletedAt_idx" ON "stored_files"("deletedAt");

CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");
CREATE INDEX "api_keys_organizationId_revokedAt_idx" ON "api_keys"("organizationId", "revokedAt");
CREATE INDEX "api_keys_org_createdAt_id_desc_idx" ON "api_keys"("organizationId", "createdAt" DESC, "id" DESC);
CREATE INDEX "api_keys_createdById_idx" ON "api_keys"("createdById");

CREATE INDEX "notifications_org_user_createdAt_id_desc_idx" ON "notifications"("organizationId", "userId", "createdAt" DESC, "id" DESC);
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

CREATE UNIQUE INDEX "feature_flags_organizationId_key_key" ON "feature_flags"("organizationId", "key");
CREATE INDEX "feature_flags_org_createdAt_id_desc_idx" ON "feature_flags"("organizationId", "createdAt" DESC, "id" DESC);

CREATE UNIQUE INDEX "terms_type_version_key" ON "terms"("type", "version");
CREATE INDEX "terms_type_publishedAt_idx" ON "terms"("type", "publishedAt" DESC);

CREATE UNIQUE INDEX "term_acceptances_termId_userId_key" ON "term_acceptances"("termId", "userId");
CREATE INDEX "term_acceptances_userId_acceptedAt_idx" ON "term_acceptances"("userId", "acceptedAt" DESC);

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeOrganizationId_fkey" FOREIGN KEY ("activeOrganizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeTeamId_fkey" FOREIGN KEY ("activeTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "members" ADD CONSTRAINT "members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "members" ADD CONSTRAINT "members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_roles" ADD CONSTRAINT "organization_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "term_acceptances" ADD CONSTRAINT "term_acceptances_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "term_acceptances" ADD CONSTRAINT "term_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stored_files_tenant_isolation" ON "stored_files"
  USING ("organizationId" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_tenant_read" ON "audit_logs" FOR SELECT
  USING ("organizationId" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
CREATE POLICY "audit_logs_tenant_write" ON "audit_logs" FOR INSERT
  WITH CHECK ("organizationId" IS NULL OR "organizationId" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Idempotent partition factory called from the scheduler's daily cron and below to seed the
-- initial window. `IF NOT EXISTS` covers concurrent ticks. Runtime scheduler roles must not own
-- application tables, so this runs SECURITY DEFINER with a fixed search_path, scoped to the
-- migration role and revoked from PUBLIC.
-- Schema-qualified: `CREATE SCHEMA IF NOT EXISTS "public"` above does not change the migration
-- role's active schema, so an unqualified CREATE FUNCTION would land wherever the role's
-- search_path resolves first. The REVOKE below targets `public.ensure_audit_log_partition`
-- explicitly, so a function created outside `public` would leave that REVOKE failing to find it.
CREATE OR REPLACE FUNCTION public.ensure_audit_log_partition(target_month timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- `date_trunc('month', timestamptz)` truncates in the session's TimeZone setting, not UTC —
  -- a session on a non-UTC offset (e.g. UTC+2, just after local midnight) can truncate to the
  -- previous month. Converting to a naive UTC timestamp before truncating removes the session
  -- TimeZone from the calculation entirely, so the boundary is always the UTC month.
  start_ts timestamptz := date_trunc('month', target_month AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
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

SELECT public.ensure_audit_log_partition(NOW() - INTERVAL '1 month');
SELECT public.ensure_audit_log_partition(NOW());
SELECT public.ensure_audit_log_partition(NOW() + INTERVAL '1 month');
SELECT public.ensure_audit_log_partition(NOW() + INTERVAL '2 months');

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

CREATE OR REPLACE FUNCTION emit_organization_created_outbox() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "outbox_events" ("id", "organizationId", "eventType", "aggregateId", "payload", "attempts")
  VALUES (uuidv7(), NEW."id", 'organizations.created', NEW."id"::text,
    jsonb_build_object('schemaVersion', 1, 'eventId', uuidv7()::text,
      'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'payload', jsonb_build_object('name', NEW."name", 'slug', NEW."slug")), 0);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER organization_created_outbox AFTER INSERT ON "organizations" FOR EACH ROW EXECUTE FUNCTION emit_organization_created_outbox();

CREATE OR REPLACE FUNCTION emit_organization_deleted_outbox() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "outbox_events" ("id", "eventType", "aggregateId", "payload", "attempts")
  VALUES (uuidv7(), 'organizations.deleted', OLD."id"::text,
    jsonb_build_object('schemaVersion', 1, 'eventId', uuidv7()::text,
      'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'payload', jsonb_build_object('name', OLD."name", 'slug', OLD."slug")), 0);
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER organization_deleted_outbox AFTER DELETE ON "organizations" FOR EACH ROW EXECUTE FUNCTION emit_organization_deleted_outbox();

CREATE OR REPLACE FUNCTION emit_organization_member_added_outbox() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "outbox_events" ("id", "organizationId", "eventType", "aggregateId", "payload", "attempts")
  VALUES (uuidv7(), NEW."organizationId", 'organizations.member_added', NEW."organizationId"::text,
    jsonb_build_object('schemaVersion', 1, 'eventId', uuidv7()::text,
      'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'payload', jsonb_build_object('userId', NEW."userId"::text, 'role', NEW."role")), 0);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER organization_member_added_outbox AFTER INSERT ON "members" FOR EACH ROW EXECUTE FUNCTION emit_organization_member_added_outbox();

CREATE OR REPLACE FUNCTION emit_organization_member_removed_outbox() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organizationId") THEN
    INSERT INTO "outbox_events" ("id", "organizationId", "eventType", "aggregateId", "payload", "attempts")
    VALUES (uuidv7(), OLD."organizationId", 'organizations.member_removed', OLD."organizationId"::text,
      jsonb_build_object('schemaVersion', 1, 'eventId', uuidv7()::text,
        'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'payload', jsonb_build_object('userId', OLD."userId"::text, 'role', OLD."role")), 0);
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER organization_member_removed_outbox AFTER DELETE ON "members" FOR EACH ROW EXECUTE FUNCTION emit_organization_member_removed_outbox();

CREATE OR REPLACE FUNCTION emit_organization_member_role_updated_outbox() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."role" IS DISTINCT FROM NEW."role" THEN
    INSERT INTO "outbox_events" ("id", "organizationId", "eventType", "aggregateId", "payload", "attempts")
    VALUES (uuidv7(), NEW."organizationId", 'organizations.member_role_updated', NEW."organizationId"::text,
      jsonb_build_object('schemaVersion', 1, 'eventId', uuidv7()::text,
        'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'payload', jsonb_build_object('userId', NEW."userId"::text, 'oldRole', OLD."role", 'role', NEW."role")), 0);
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER organization_member_role_updated_outbox AFTER UPDATE OF "role" ON "members" FOR EACH ROW EXECUTE FUNCTION emit_organization_member_role_updated_outbox();

CREATE OR REPLACE FUNCTION emit_organization_role_changed_outbox() RETURNS TRIGGER AS $$
DECLARE
  target_organization_id UUID;
  target_role TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_organization_id := OLD."organizationId";
    target_role := OLD."role";
  ELSE
    target_organization_id := NEW."organizationId";
    target_role := NEW."role";
  END IF;
  INSERT INTO "outbox_events" ("id", "organizationId", "eventType", "aggregateId", "payload", "attempts")
  VALUES (uuidv7(), target_organization_id, 'organizations.role_changed', target_organization_id::text,
    jsonb_build_object('schemaVersion', 1, 'eventId', uuidv7()::text,
      'occurredAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'payload', jsonb_build_object('role', target_role, 'action', TG_OP)), 0);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER organization_role_changed_outbox AFTER INSERT OR UPDATE OR DELETE ON "organization_roles" FOR EACH ROW EXECUTE FUNCTION emit_organization_role_changed_outbox();

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
