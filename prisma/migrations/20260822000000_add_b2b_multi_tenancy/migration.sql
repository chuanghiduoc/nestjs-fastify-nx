-- Additive B2B migration for databases that already applied 20260501000000_init.
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "activeOrganizationId" UUID,
  ADD COLUMN IF NOT EXISTS "activeTeamId" UUID;

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "logo" TEXT,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "members" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invitations" (
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

CREATE TABLE IF NOT EXISTS "teams" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "name" TEXT NOT NULL,
  "organizationId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3),
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "team_members" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "teamId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organization_roles" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "organizationId" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3),
  CONSTRAINT "organization_roles_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stored_files"
  ADD COLUMN IF NOT EXISTS "organizationId" UUID,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "organizationId" UUID;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "organizationId" UUID;

-- These indexes must exist before the idempotent backfill uses their ON CONFLICT targets.
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "members_organizationId_userId_key" ON "members"("organizationId", "userId");

-- Existing users receive a private owner organization. Existing files are assigned through
-- their owner; operators must resolve any historical orphan rows before this constraint runs.
INSERT INTO "organizations" ("name", "slug")
SELECT COALESCE(NULLIF(u."name", ''), split_part(u."email", '@', 1)),
       'ws-' || replace(u."id"::text, '-', '')
FROM "users" u
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "members" ("organizationId", "userId", "role")
SELECT o."id", u."id", 'owner'
FROM "users" u
JOIN "organizations" o ON o."slug" = 'ws-' || replace(u."id"::text, '-', '')
ON CONFLICT ("organizationId", "userId") DO NOTHING;

UPDATE "stored_files" sf
SET "organizationId" = m."organizationId"
FROM "members" m
WHERE sf."organizationId" IS NULL AND m."userId" = sf."userId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "stored_files" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce stored_files.organizationId: historical rows need an operator-supplied backfill';
  END IF;
END $$;
ALTER TABLE "stored_files" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX IF NOT EXISTS "organizations_createdAt_id_desc_idx" ON "organizations"("createdAt" DESC, "id" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "members_organizationId_userId_key" ON "members"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "members_userId_idx" ON "members"("userId");
CREATE INDEX IF NOT EXISTS "members_org_createdAt_id_desc_idx" ON "members"("organizationId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "invitations_organizationId_status_idx" ON "invitations"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "invitations_email_status_idx" ON "invitations"("email", "status");
CREATE INDEX IF NOT EXISTS "invitations_expiresAt_idx" ON "invitations"("expiresAt");
CREATE INDEX IF NOT EXISTS "invitations_inviterId_idx" ON "invitations"("inviterId");
CREATE INDEX IF NOT EXISTS "invitations_teamId_idx" ON "invitations"("teamId");
CREATE UNIQUE INDEX IF NOT EXISTS "teams_organizationId_name_key" ON "teams"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "teams_org_createdAt_id_desc_idx" ON "teams"("organizationId", "createdAt" DESC, "id" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");
CREATE INDEX IF NOT EXISTS "team_members_userId_idx" ON "team_members"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_roles_organizationId_role_key" ON "organization_roles"("organizationId", "role");
CREATE INDEX IF NOT EXISTS "sessions_activeOrganizationId_idx" ON "sessions"("activeOrganizationId");
CREATE INDEX IF NOT EXISTS "sessions_activeTeamId_idx" ON "sessions"("activeTeamId");
CREATE INDEX IF NOT EXISTS "stored_files_organizationId_status_idx" ON "stored_files"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "stored_files_org_createdAt_id_desc_idx" ON "stored_files"("organizationId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "stored_files_deletedAt_idx" ON "stored_files"("deletedAt");
CREATE INDEX IF NOT EXISTS "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt" DESC);

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeOrganizationId_fkey"
  FOREIGN KEY ("activeOrganizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeTeamId_fkey"
  FOREIGN KEY ("activeTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "members" ADD CONSTRAINT "members_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "members" ADD CONSTRAINT "members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviterId_fkey"
  FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_roles" ADD CONSTRAINT "organization_roles_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stored_files_tenant_isolation" ON "stored_files"
  USING ("organizationId" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_tenant_read" ON "audit_logs" FOR SELECT
  USING ("organizationId" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
CREATE POLICY "audit_logs_tenant_write" ON "audit_logs" FOR INSERT
  WITH CHECK ("organizationId" IS NULL OR "organizationId" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

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
