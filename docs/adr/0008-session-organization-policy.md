# ADR-0008: Session organization provisioning belongs to Organizations

- **Status**: Proposed
- **Date**: 2026-09-19

## Context

Better Auth's session creation hook previously performed organization lookup,
workspace naming, advisory locking and membership creation inside auth config.
Reading the Organizations module did not reveal this write path. Infra cannot
import a domain module under the workspace dependency rules.

## Decision

The auth adapter requires an `AuthSessionPolicy` when it is configured. API
composition supplies the policy through `BetterAuthModule.forRoot()` and maps
organization resolution to `EnsurePersonalOrganizationCommand` on CommandBus.
The Organizations module registers the handler and owns its repository port.
Neither infra-auth nor another bounded context imports the handler.

Provisioning stays synchronous before session insertion. The application handler
selects the existing membership or computes defaults; the repository serializes
creation by user on the primary database. It reuses an enclosing transaction when
present and otherwise opens a transaction for organization and owner creation.

Existing PostgreSQL triggers remain the sole producers of organization and member
events for these writes. Publishing the same events from the command would
duplicate delivery. Organization creation and session insertion remain separate
transactions, as before; retry reuses the existing organization.

## Consequences

The complete call path is visible in API composition and in the Organizations
module. Auth setup now requires an explicit policy, including any direct caller
of `createBetterAuth`. AppModule and the OpenAPI exporter share the same wiring.
The policy does not execute during module construction; CommandBus handlers must
be registered by application initialization before auth requests are served.

This does not transfer ownership of all Better Auth organization endpoints. The
two authorization engines, their parity checks and current client contracts stay
in place. See [the flow guide](../authentication-flow.md) for the exact boundary.

## Alternatives rejected

- Moving the helper to another infra file keeps domain ownership implicit.
- Importing Organizations from infra-auth violates module boundaries.
- An asynchronous signup listener cannot guarantee an organization on the first
  session, and does not cover existing users without memberships at sign-in.
- Replacing the organization plugin in the same change mixes a behavior-preserving
  refactor with a public API and permission-model migration.
