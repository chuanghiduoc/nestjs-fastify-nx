# ADR-0004: Deletion is three distinct mechanisms, not one flag

- **Status**: Accepted
- **Date**: 2026-08-20

## Context

"Delete" in a B2B SaaS means at least three different things, and conflating them
produces either data loss the customer cannot undo, or storage that grows forever
because nothing is ever really removed. A tenant also expects a mistaken delete to
be recoverable, while a regulator expects a deletion request to actually erase
data. Those two expectations pull in opposite directions and need separate
mechanisms.

## Decision

| Mechanism       | Marker                                 | Reversible       | Use for                                                              |
| --------------- | -------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| **Deactivate**  | `User.status = INACTIVE / BANNED`      | Yes              | Suspending access. The record still matters and is not being removed |
| **Soft delete** | `deletedAt` timestamp                  | Yes, until purge | A user removing their own data. Hidden from every read immediately   |
| **Hard delete** | Row gone + external resources released | No               | Retention expiry, and erasure requests                               |

### Rules

1. **`deletedAt` is a timestamp, never a boolean.** `isDeleted` cannot answer
   "when", so it cannot drive a retention window, and it makes the row's history
   unreconstructable.
2. **Soft delete is a compare-and-set on the live row** (`WHERE deletedAt IS NULL`).
   A repeated DELETE must not restamp `deletedAt` — that silently pushes the
   retention deadline out on every retry, so a client retry loop would keep data
   alive forever.
3. **Every read path filters `deletedAt: null`.** Including compare-and-set
   updates: a soft-deleted row must not be transitionable back into an active
   state.
4. **Hard delete releases external resources first, the row second.** The row is
   the only pointer to the object; dropping it first leaks the object in the
   bucket permanently. The reverse order is safe to retry because deleting a
   missing object succeeds and `deleteMany` matches zero rows.
5. **Ownership failures answer `not_found`, never `forbidden`.** Telling a caller
   "you may not delete this" confirms the resource exists. For a resource that
   another member of the same organization owns, that is a leak.
6. **A unique business key must become a partial unique index**
   (`WHERE "deletedAt" IS NULL`) so a soft-deleted row does not keep the value
   reserved. A physical identifier that is never reused (`stored_files.key`) keeps
   its full unique index instead — two soft-deleted rows sharing one storage key
   would be a bug, not a feature. Prisma 7 cannot declare partial indexes, so this
   requires a hand-written index and the drift it causes must be handled
   deliberately; the current tables need none.

### Where it is implemented

- `stored_files.deletedAt` + `DELETE /api/v1/upload/{id}` (soft, `204`,
  idempotent).
- `StoredFileCleanupTask.purgeSoftDeleted()` — daily, leader-gated, purges rows
  past `STORED_FILE_PURGE_AFTER_DAYS` (default 30) after deleting the object.
- The existing status-driven cleanups are unchanged: `REJECTED`, stale
  `FINALIZING`/`VERIFYING` and owner-orphaned rows are still hard-deleted directly,
  because none of them is a user-visible file worth a recovery window.

## Consequences

- A mistaken delete is recoverable for 30 days by clearing `deletedAt`; after
  that the object is gone and unrecoverable, which is the point.
- Storage cost carries a 30-day tail on deleted files. That is the price of
  reversibility and should be stated in customer-facing docs.
- Every future tenant-owned table repeats this shape. A table that opts out must
  say why.
- **Known edge:** `stored_files.sourceKey` keeps a full unique index (rule 6), so
  re-confirming the _same_ presigned key after its file was soft-deleted hits the
  unique constraint and answers `409` from the Prisma mapping rather than a
  purpose-built error. That is the correct status, and the case only arises from a
  stale client retry — presign mints a fresh key every time.
- Not yet covered: erasure on request (GDPR) needs a path that purges
  immediately rather than waiting for the retention window, and it must span
  every table holding the subject's data — that is a cross-module concern and
  belongs with the account-deletion flow, not here.

## Alternatives rejected

- **Hard delete only.** Simplest, and wrong for a product where a customer can
  delete the wrong file: support has nothing to restore from.
- **Soft delete everywhere, purge never.** Storage and index bloat grow without
  bound, and "deleted" data that is never erased is a compliance liability.
- **A global Prisma middleware that filters `deletedAt` automatically.** Rejected
  for the same reason as the tenancy extension in ADR-0001: it hides the rule at
  the point where a reader most needs to see it, and it silently changes the
  meaning of every query including the ones that legitimately need deleted rows
  (the purge job).
