# upload

Tenant-owned file uploads: presign → browser/backend POST → confirm → verify →
serve. State machine is `FINALIZING → VERIFYING → READY/REJECTED` with
compare-and-set transitions and soft-delete retention.

- Presigned keys are server-generated: `uploads/<userId>/<uuid>.<ext>`.
- Confirm binds the copy to the validated ETag (`CopySourceIfMatch`).
- `MALWARE_SCANNER_ENABLED=false` (default) verifies magic bytes inline and
  returns `READY`; `true` enqueues worker verification.
- Reads/deletes re-check organization and resource-level `file:read`/`file:delete`
  and answer 404 for other tenants.
- Scheduler tasks purge stale `FINALIZING`/`VERIFYING`/`REJECTED` rows, orphaned
  objects, and soft-deleted files after their retention window.
