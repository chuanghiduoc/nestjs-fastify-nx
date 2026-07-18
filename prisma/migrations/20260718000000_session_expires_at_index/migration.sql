-- Backs the scheduler's expired-session purge (SessionCleanupTask). Better Auth never deletes a
-- session row itself, so without this index "WHERE expiresAt < cutoff" degrades into a sequential
-- scan as the table grows unbounded.
--
-- Not CONCURRENTLY: migrate deploy wraps each migration in a transaction, which CONCURRENTLY
-- cannot run inside. This briefly locks writes; on an already-large sessions table in real prod,
-- build it out-of-band with `CREATE INDEX CONCURRENTLY` instead of via this migration.
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
