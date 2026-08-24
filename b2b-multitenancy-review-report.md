# B2B multi-tenancy review - post-fix verification

Review target: `feat/b2b-multi-tenancy` on 2026-08-22, compared with `origin/main`.

## Fixed in this pass

- Restored the shipped `20260501000000_init` migration to the `origin/main` version and moved all B2B DDL/backfill/RLS/triggers into `20260822000000_add_b2b_multi_tenancy`.
- Verified a real PostgreSQL migration from the old init through the new B2B migration.
- Replaced user-derived personal-organization slugs with random UUIDv7-based slugs and made organization/member creation transactional with a per-user advisory lock.
- Revalidated active organization membership on every authenticated request. Active team context is accepted only when the user belongs to that team in the active organization.
- Required current membership before user owner-scoped authorization grants; organization and role filters are now tenant-scoped.
- Changed system-role detection to own-property semantics and added a conformance case for prototype keys.
- Prevented stale `VERIFYING`/`FINALIZING` uploads from being promoted directly to `READY`; stale unverified objects are rejected and deleted.
- Added the stored-file UUID to confirm/recovery responses so clients can call the DELETE endpoint.
- Added a scheduled organization anti-join cleanup for files whose organization was deleted.
- Stopped attributing member add/remove events to the affected member as actor; the subject is preserved as `memberUserId` metadata.
- Member listing now filters and returns the organization membership role, including custom role names, rather than the platform role.
- Added outbox events for membership-role updates and custom organization-role changes.
- Added the missing `sessions.activeTeamId` index.

## Remaining product decision

New sessions still select the oldest membership as the initial active organization. This is isolated and authorized, but users in several organizations may need to switch tenant after signing in. Persisting the last selected organization requires an explicit product rule for revoked/deleted organizations and first login on a new device.

## Verification

- Full typecheck passed for all 22 Nx projects.
- PostgreSQL integration migration passed with both migrations applied in order.
- Authorization PostgreSQL conformance passed.
- Unit suites passed for auth, authorization, scheduler, upload, audit log, users, API, and admin composition.
- `git diff --check` passed.
