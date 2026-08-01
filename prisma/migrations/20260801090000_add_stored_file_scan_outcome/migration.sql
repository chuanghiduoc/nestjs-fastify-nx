-- ClamAV skips any file past its internal 2 GiB ceiling. Recording the outcome keeps READY from
-- implying the object was inspected: SKIPPED_TOO_LARGE says plainly that nothing scanned it.
ALTER TABLE "stored_files" ADD COLUMN "scanOutcome" TEXT;
