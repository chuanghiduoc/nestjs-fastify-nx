-- Better Auth 1.7 scopes account identity by issuer instead of providerId.
-- Backfill mirrors createLocalAccountIssuer/createOAuthAccountIssuer: credential accounts get
-- `local:<providerId>`, every OAuth provider without an issuer of its own gets `local:oauth:<providerId>`.
ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "issuer" TEXT;

UPDATE "accounts"
SET "issuer" = CASE
  WHEN "providerId" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "providerId"
END
WHERE "issuer" IS NULL;

ALTER TABLE "accounts"
  ALTER COLUMN "issuer" SET NOT NULL;

DROP INDEX IF EXISTS "accounts_providerId_accountId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "accounts_issuer_accountId_key" ON "accounts"("issuer", "accountId");
