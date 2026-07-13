CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FINALIZING',
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stored_files_size_check" CHECK ("size" > 0),
    CONSTRAINT "stored_files_status_check" CHECK ("status" IN ('FINALIZING', 'VERIFYING', 'READY', 'REJECTED'))
);

CREATE UNIQUE INDEX "stored_files_sourceKey_key" ON "stored_files"("sourceKey");
CREATE UNIQUE INDEX "stored_files_key_key" ON "stored_files"("key");
CREATE INDEX "stored_files_userId_status_idx" ON "stored_files"("userId", "status");
CREATE INDEX "stored_files_status_updatedAt_idx" ON "stored_files"("status", "updatedAt");
