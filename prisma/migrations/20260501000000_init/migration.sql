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

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");
CREATE INDEX "users_status_updatedAt_idx" ON "users"("status", "updatedAt");

CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");

CREATE INDEX "outbox_events_processedAt_createdAt_idx" ON "outbox_events"("processedAt", "createdAt");

CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotent partition factory called from the scheduler's daily cron and
-- below to seed the initial window. `IF NOT EXISTS` covers concurrent ticks.
CREATE OR REPLACE FUNCTION ensure_audit_log_partition(target_month timestamptz)
RETURNS void AS $$
DECLARE
  start_ts timestamptz := date_trunc('month', target_month);
  end_ts   timestamptz := start_ts + INTERVAL '1 month';
  pname    text := 'audit_logs_' || to_char(start_ts AT TIME ZONE 'UTC', 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF "audit_logs" FOR VALUES FROM (%L) TO (%L)',
    pname, start_ts AT TIME ZONE 'UTC', end_ts AT TIME ZONE 'UTC'
  );
END;
$$ LANGUAGE plpgsql;

SELECT ensure_audit_log_partition(NOW() - INTERVAL '1 month');
SELECT ensure_audit_log_partition(NOW());
SELECT ensure_audit_log_partition(NOW() + INTERVAL '1 month');
SELECT ensure_audit_log_partition(NOW() + INTERVAL '2 months');

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

CREATE OR REPLACE FUNCTION emit_user_logged_out_outbox()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "outbox_events" ("id", "eventType", "aggregateId", "payload", "attempts")
  VALUES (
    uuidv7(),
    'users.logged_out',
    OLD."userId"::text,
    jsonb_build_object(
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
EXECUTE FUNCTION emit_user_logged_out_outbox();
