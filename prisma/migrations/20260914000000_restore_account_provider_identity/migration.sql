-- Better Auth 1.7.3 identifies accounts by providerId/accountId and no longer writes issuer.
-- Retain historical issuer values while allowing new accounts to omit the column.
-- Create the replacement index first: duplicate provider identities must fail the
-- migration for manual resolution, never merge identities belonging to different users.
BEGIN;

CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");
ALTER TABLE "accounts" ALTER COLUMN "issuer" DROP NOT NULL;
DROP INDEX "accounts_issuer_accountId_key";

COMMIT;
