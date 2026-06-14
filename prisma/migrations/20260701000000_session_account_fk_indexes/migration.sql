-- Foreign-key index hardening for the Better Auth tables:
--   - `sessions.userId` is read on every authenticated request when Better Auth
--     resolves the active session, and the ON DELETE CASCADE from `users` walks
--     it during account deletion. Without a standalone index Postgres falls back
--     to a sequential scan as the sessions table grows.
--   - `accounts.userId` has the same CASCADE-delete requirement; the existing
--     UNIQUE on (providerId, accountId) does not cover userId lookups.
--
-- Idempotent (CREATE INDEX IF NOT EXISTS). CREATE INDEX CONCURRENTLY cannot run
-- inside the migration transaction wrapper, so plain CREATE INDEX is used —
-- acceptable for these small tables on an initial bootstrap.

CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions" ("userId");

CREATE INDEX IF NOT EXISTS "accounts_userId_idx" ON "accounts" ("userId");
