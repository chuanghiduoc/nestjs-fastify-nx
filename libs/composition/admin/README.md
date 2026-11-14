# composition-admin

Cross-context orchestrator for staff-facing administration surfaces. Wires routes
to CQRS handlers owned by feature modules; it owns no entities, repositories, or
business rules.

- `AdminUsersController` lists organization members through `member:read` (the
  organization axis), never `@Roles('ADMIN')`.
- Bull Board is currently mounted from `apps/api/src/common/bull-board/` because
  it needs raw Fastify plugin access; the lib does not host it.
- Business logic that seems to belong here belongs in the owning module, usually
  as a missing domain event.
