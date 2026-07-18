-- Better Auth reads "verifications" only by "identifier", ordered by "createdAt" — every
-- password-reset, email-verification and delete-account confirmation takes that path.
-- "expiresAt" backs the scheduler's expired-token purge.
--
-- Not CONCURRENTLY: migrate deploy wraps each migration in a transaction, which CONCURRENTLY
-- cannot run inside. This briefly locks writes; purge expired rows first if the table is large.
CREATE INDEX "verifications_identifier_createdAt_idx" ON "verifications"("identifier", "createdAt" DESC);
CREATE INDEX "verifications_expiresAt_idx" ON "verifications"("expiresAt");
