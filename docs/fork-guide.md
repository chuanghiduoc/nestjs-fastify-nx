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

| Concern                                     | Location               |
| ------------------------------------------- | ---------------------- |
| HTTP bootstrap, CORS, Helmet, rate limiting | `apps/api/src/main.ts` |
| Authentication, sessions, and role guards   | `libs/infra/auth`      |
| User use cases and repositories             | `libs/modules/users`   |
| Upload presign and confirmation             | `libs/modules/upload`  |
| Prisma schema and migrations                | `prisma/`              |
| Queue processing                            | `apps/worker`          |
| Cron jobs and outbox relay                  | `apps/scheduler`       |
| Database, Redis, and S3 adapters            | `libs/infra`           |
| DTOs, errors, and OpenAPI contracts         | `libs/contracts`       |
| Generated REST client                       | `libs/api-client`      |

After changing a DTO or controller, run:

```bash
pnpm codegen:full
pnpm typecheck:all
pnpm nx run-many -t lint --all
pnpm test -- --run
```
