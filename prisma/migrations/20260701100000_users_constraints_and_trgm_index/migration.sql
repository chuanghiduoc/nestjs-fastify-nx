-- User-table hardening:
--   1. CHECK constraints pin `role`/`status` to their domain enum values at the
--      DB layer. The columns are plain text (Better Auth writes them directly),
--      so a manual insert or a future bug could otherwise persist an invalid
--      value the application would then choke on.
--   2. pg_trgm GIN indexes back the case-insensitive email/name search
--      (`ILIKE '%term%'`) the admin user list issues, so it stays off a full
--      sequential scan as the users table grows.
--
-- Idempotent: ADD CONSTRAINT guarded by a pg_constraint lookup, CREATE
-- EXTENSION / INDEX IF NOT EXISTS. CREATE INDEX CONCURRENTLY cannot run inside
-- the migration transaction wrapper, so plain CREATE INDEX is used — acceptable
-- for these table sizes on an initial bootstrap.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_role_chk' AND conrelid = '"users"'::regclass
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_role_chk"
      CHECK ("role" IN ('ADMIN', 'USER'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_status_chk' AND conrelid = '"users"'::regclass
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_status_chk"
      CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'BANNED'));
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "users_email_trgm_idx" ON "users" USING gin ("email" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "users_name_trgm_idx" ON "users" USING gin ("name" gin_trgm_ops);
