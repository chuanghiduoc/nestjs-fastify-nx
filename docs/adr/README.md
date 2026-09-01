# Architecture Decision Records

One file per decision that is expensive to reverse. Numbered, immutable once
accepted: a decision that changes gets a new ADR that supersedes the old one,
the old file stays for the reasoning trail.

| ADR                                             | Title                                                                                | Status   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| [0001](0001-multi-tenancy-model.md)             | Multi-tenancy: shared schema, organization-scoped, RLS-enforced                      | Accepted |
| [0002](0002-authorization-engine-port.md)       | Authorization behind a port so PBAC and ReBAC are interchangeable                    | Accepted |
| [0003](0003-billing-provider-port.md)           | Billing state is internal; payment providers are thin adapters                       | Accepted |
| [0004](0004-deletion-model.md)                  | Deletion is three distinct mechanisms, not one flag                                  | Accepted |
| [0005](0005-trusted-proxy-allow-list.md)        | Client IP resolution trusts an allow-list, not a hop count                           | Accepted |
| [0006](0006-shared-e2e-application-instance.md) | The e2e suite shares one module registry, one application and one database container | Accepted |
| [0007](0007-api-key-authentication.md)          | API keys are hashed bearer credentials, and routes opt into them                     | Accepted |

## Template

```markdown
# ADR-XXXX: <title>

- **Status**: Proposed | Accepted | Superseded by ADR-YYYY
- **Date**: YYYY-MM-DD

## Context

What forces are at play. What must be true. What is unknown.

## Decision

What we do, stated so a reader can implement it without guessing.

## Consequences

What this costs, what it forbids, what breaks at scale, how we would know it
was wrong.

## Alternatives rejected

Each with the reason it lost — not a list of names.
```
