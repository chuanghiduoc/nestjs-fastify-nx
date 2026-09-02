# Fork guide: running and understanding the codebase

This is the shortest path for a developer who forks the repository and needs to
understand the deployable services, API surfaces, and code ownership.

## Why are there four production env files?

Local development only needs one shared `.env`. Production separates runtime
configuration into:

| File             | Process             | Main credential scope                          |
| ---------------- | ------------------- | ---------------------------------------------- |
| `.env.api`       | Fastify API         | session/auth, S3, CORS, API database role      |
| `.env.worker`    | BullMQ worker       | queues, mail, S3, ClamAV, worker database role |
| `.env.scheduler` | cron + outbox relay | queue/cache, scheduler database role           |
| `.env.migration` | Prisma migration    | migration/admin database role                  |

This reduces the blast radius: the API does not automatically receive SMTP
credentials, the worker cannot migrate or alter the schema, the scheduler does
not receive API credentials, and the migration credential is not present in a
request-serving process. These files are ignored by Git; commit only
`.env.example`, never real values.

Local forks need only `.env` because all services use local development
credentials. For production, create the four files as described in
[deployment.md](deployment.md).

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose -f docker/compose.yml -f docker/compose.dev.yml up -d
pnpm db:migrate
pnpm nx serve api
```

The API runs at `http://localhost:3000` by default.

## Endpoint map

`/api` is the global prefix and `/v1` is the default URI version. Errors use
`application/problem+json` and include `X-Request-Id`.

### REST

| Method | Endpoint                      | Auth              | Purpose                            |
| ------ | ----------------------------- | ----------------- | ---------------------------------- |
| `GET`  | `/`                           | public            | service name and version           |
| `GET`  | `/api/v1/health/live`         | public            | liveness probe                     |
| `GET`  | `/api/v1/health/ready`        | public            | readiness: PostgreSQL + Redis      |
| `GET`  | `/api/v1/health`              | public            | aggregate health check             |
| `GET`  | `/api/v1/health/dependencies` | metrics allowlist | BullMQ, PgBouncer, and replica lag |
| `GET`  | `/metrics`                    | metrics allowlist | Prometheus metrics                 |
| `GET`  | `/api/v1/users/me`            | session cookie    | current user profile               |
| `POST` | `/api/v1/upload/presign`      | session cookie    | issue a presigned POST policy      |
| `POST` | `/api/v1/upload/confirm`      | session cookie    | confirm an upload                  |

Tenant-facing endpoints, each gated by an organization permission rather than a platform role
(creating or publishing legal documents is the one back-office exception: it is gated by the
platform `ADMIN` role because a term binds every tenant):

| Method                  | Endpoint                                          | Permission                        |
| ----------------------- | ------------------------------------------------- | --------------------------------- |
| `GET`                   | `/api/v1/organizations/current`                   | `organization:read`               |
| `GET`/`POST`            | `/api/v1/organizations/current/roles`             | `role:read` / `role:create`       |
| `PATCH`/`DELETE`        | `/api/v1/organizations/current/roles/{role}`      | `role:update` / `role:delete`     |
| `GET`/`POST`            | `/api/v1/organizations/current/teams`             | `team:read` / `team:create`       |
| `PATCH`/`DELETE`        | `/api/v1/organizations/current/teams/{id}`        | `team:update` / `team:delete`     |
| `GET`                   | `/api/v1/organizations/current/invitations`       | `invitation:read`                 |
| `DELETE`                | `/api/v1/organizations/current/invitations/{id}`  | `invitation:cancel`               |
| `GET`                   | `/api/v1/audit-logs`                              | `audit_log:read`                  |
| `GET`/`POST`            | `/api/v1/api-keys`                                | `api_key:read` / `api_key:create` |
| `DELETE`                | `/api/v1/api-keys/{id}`                           | `api_key:revoke`                  |
| `GET`                   | `/api/v1/notifications`                           | `notification:read`               |
| `POST`                  | `/api/v1/notifications/{id}/read`, `/read-all`    | `notification:update`             |
| `GET`                   | `/api/v1/feature-flags`, `/evaluate`              | `feature_flag:read`               |
| `POST`/`PATCH`/`DELETE` | `/api/v1/feature-flags[/{id}]`                    | `feature_flag:manage`             |
| `GET`                   | `/api/v1/terms`, `/{type}/latest`, `/acceptances` | `term:read`                       |
| `POST`                  | `/api/v1/terms/{id}/accept`                       | `term:accept`                     |
| `POST`                  | `/api/v1/terms[/{id}/publish]`                    | platform `ADMIN` (`User.role`)    |
| `GET`/`DELETE`          | `/api/v1/sessions[/{id}]`                         | `session:read` / `session:revoke` |
| `POST`                  | `/api/v1/sessions/revoke-others`                  | `session:revoke`                  |

Two endpoints also accept an API key (`Authorization: Bearer sk_…` or `X-Api-Key`):
`GET /api/v1/feature-flags` and `GET /api/v1/feature-flags/evaluate`. A route accepts a key only
when it carries `@AllowApiKey()` — see [ADR-0007](adr/0007-api-key-authentication.md).

Upload flow:

```text
POST /api/v1/upload/presign { "contentType": "image/png" }
  -> browser POSTs multipart data directly to S3/MinIO
  -> POST /api/v1/upload/confirm { "key": "uploads/<user>/<file>.png" }
  -> VERIFYING -> worker checks magic bytes + ClamAV -> READY
```

A download URL is returned only after the file reaches `READY`.

### Authentication

Better Auth is mounted under `/api/auth/*`, uses cookie sessions, and does not
use JWTs. Common routes include:

```text
POST /api/auth/sign-up/email
POST /api/auth/sign-in/email
POST /api/auth/sign-out
GET  /api/auth/get-session
POST /api/auth/request-password-reset
POST /api/auth/reset-password
```

Use `/docs` or the generated OpenAPI document for the complete list because
Better Auth may add provider or social-login routes.

### GraphQL

Endpoint: `POST /graphql`.

```graphql
query {
  me {
    id
    email
    name
    role
    status
  }
}
```

The `users(...)` query requires the `ADMIN` role. Introspection is disabled in
production.

### WebSocket

Socket.IO uses the `/ws` path and authenticates with the session cookie or a
handshake token, as implemented by the current adapter. Browser clients should
send the cookie from the same origin; other clients should use `auth.token`.

## Where to find the code

| Concern                                     | Location                             |
| ------------------------------------------- | ------------------------------------ |
| HTTP bootstrap, CORS, Helmet, rate limiting | `apps/api/src/main.ts`               |
| Authentication, sessions, and role guards   | `libs/infra/auth`                    |
| User use cases and repositories             | `libs/modules/users`                 |
| Upload presign and confirmation             | `libs/modules/upload`                |
| Roles, teams, invitations                   | `libs/modules/organizations`         |
| Machine credentials                         | `libs/modules/api-keys`              |
| In-app notifications                        | `libs/modules/notifications`         |
| Feature flags                               | `libs/modules/feature-flags`         |
| Legal terms and acceptance                  | `libs/modules/terms`                 |
| Session listing and revocation              | `libs/modules/sessions`              |
| Audit trail                                 | `libs/modules/audit-log`             |
| Permission catalog and system roles         | `libs/shared/src/lib/permissions.ts` |
| Prisma schema and migrations                | `prisma/`                            |
| Queue processing                            | `apps/worker`                        |
| Cron jobs and outbox relay                  | `apps/scheduler`                     |
| Database, Redis, and S3 adapters            | `libs/infra`                         |
| DTOs, errors, and OpenAPI contracts         | `libs/contracts`                     |
| Generated REST client                       | `libs/api-client`                    |

After changing a DTO or controller, run:

```bash
pnpm codegen:full
pnpm typecheck:all
pnpm nx run-many -t lint --all
pnpm test -- --run
```
