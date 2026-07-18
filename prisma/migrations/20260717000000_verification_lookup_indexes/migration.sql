-- Better Auth reads "verifications" only by "identifier" (ORDER BY "createdAt" DESC LIMIT 1) —
-- every password-reset, email-verification, and delete-account confirmation hits that path. The
-- table shipped with only its primary key, so each of those lookups was a sequential scan.
-- "expiresAt" backs the scheduler's expired-token purge, which is what keeps the table bounded.
--
-- Plain CREATE INDEX (not CONCURRENTLY): prisma migrate deploy runs each migration inside a
-- transaction, and CONCURRENTLY cannot run in one. This takes a brief write lock on "verifications".
-- The table holds only short-lived auth tokens, so it is small; on an existing deployment that let
-- it grow unbounded before the purge job existed, delete expired rows first.
CREATE INDEX "verifications_identifier_createdAt_idx" ON "verifications"("identifier", "createdAt" DESC);
CREATE INDEX "verifications_expiresAt_idx" ON "verifications"("expiresAt");
