# Getting Started

## Prerequisites

- Docker Desktop (required for PostgreSQL, Redis, MinIO)
- Node.js 22+ and pnpm 10.33+ (`corepack enable && corepack prepare pnpm@10.33.0 --activate`)

## Setup

```bash
# 1. Clone
git clone https://github.com/chuanghiduoc/nestjs-fastify-nx.git
cd nestjs-fastify-nx

# 2. Copy environment file
cp .env.example .env

# 3. Start all services (DB + Redis + MinIO + API with hot-reload)
docker compose --env-file .env -f docker/compose.yml -f docker/compose.dev.yml up
```

## Services

| Service       | URL                                                      | Credentials             |
| ------------- | -------------------------------------------------------- | ----------------------- |
| API           | [http://localhost:3000](http://localhost:3000)           | —                       |
| API Docs      | [http://localhost:3000/docs](http://localhost:3000/docs) | Scalar (dev only)       |
| MinIO Console | [http://localhost:9001](http://localhost:9001)           | minioadmin / minioadmin |
| PostgreSQL    | localhost:5432                                           | postgres / postgres     |
| Redis Cache   | localhost:6379                                           | —                       |
| Redis Queue   | localhost:6380                                           | —                       |

## Verify Installation

```bash
curl http://localhost:3000/api/v1/health
# Expected: {"status":"ok"}

curl http://localhost:3000/api/v1/health/live
# Expected: {"status":"ok","timestamp":"..."}
```

## Running Tests

```bash
# Install dependencies
pnpm install

# Unit + integration tests (uses Testcontainers — Docker required)
pnpm nx run-many --target=test --all

# E2E tests
pnpm nx run api:e2e
```

## Understand the codebase

New here? Read these in order:

1. [Architecture](architecture.md) — the big picture: monorepo layout, the layer
   diagram, module boundaries, auth flow, and the API contract.
2. [Domain Module Anatomy](domain-module-anatomy.md) — every file inside a module
   explained one-by-one (what it is, why it exists, when to create one, how to
   wire it), using the real `users` module.
3. [Creating a Module](creating-a-module.md) — scaffold a new bounded context with
   the generator once the above makes sense.

## When something breaks

See [Troubleshooting](troubleshooting.md) for common failure modes —
install errors on Windows, migration aborts, BullMQ retry exhaustion,
and image-pull issues in production.
