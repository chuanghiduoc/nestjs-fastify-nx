# Contributing

Welcome. This guide gets you from clone → first PR in under 30 minutes.

## Prerequisites

- Docker Desktop / Docker Engine with Compose v2+
- Node 24+, pnpm 11+
- Git with conventional commits awareness
- 2 GB free disk (for containers + node_modules)

## Quick Start (5 minutes)

```bash
# 1. Clone and bootstrap
cp .env.example .env
./scripts/doctor.sh                # ✅ verifies Docker, Node, ports, env vars
pnpm install
./scripts/build-dev.sh             # 🚀 boots full dev stack

# 2. Access the API
open http://localhost:3000/docs
```

Check the logs in another terminal:

```bash
docker compose logs -f api
```

Stop the stack:

```bash
./scripts/teardown.sh
```

## Architecture in 60 Seconds

Three-layer design enforced by `@nx/enforce-module-boundaries`:

1. **Bounded Contexts** (`libs/modules/*`) — DDD modules that never import each other. Examples: `users`, `audit-log`, `upload`.
2. **Composition Layer** (`libs/composition/*`) — cross-context features that depend on modules. Example: `admin` dashboard.
3. **Platform Layer** (`libs/infra/*`, `libs/core/*`) — shared auth, database, messaging, observability. Used by everything above.

**Key Rule:** If you're adding a feature that needs two modules, put it in composition — never cross-import modules directly.

See [docs/architecture.md](./docs/architecture.md) for the full diagram.

## Adding a New Module (the Canonical Path)

### 1. Scaffold via generator

```bash
pnpm gen:module payments   # shortcut → libs/modules/payments (+ nx sync)
# equivalent: pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=payments --directory=modules
```

### 2. Implement domain logic

- Aggregate roots in `domain/entities/`
- Domain events in `domain/events/`
- Repository interfaces in `domain/ports/`

### 3. Add CQRS handlers

- Commands in `application/commands/`
- Queries in `application/queries/`

### 4. Implement repositories

- Prisma adapters in `infrastructure/repositories/`

### 5. Wire controllers

- REST endpoints in `presentation/controllers/`

### 6. Export public API

- In `index.ts`, export only what consumers need

### 7. Add to AppModule

```typescript
import { PaymentsModule } from '@nestjs-fastify-nx/modules-payments';

@Module({
  imports: [PaymentsModule],
})
export class AppModule {}
```

### 8. Add Prisma model (if needed)

```bash
# Edit prisma/schema.prisma
pnpm prisma migrate dev --name "add payments table"
```

### 9. Write tests

```bash
pnpm nx test modules-payments
```

Integration tests use real Postgres via Testcontainers (no mocks).

### 10. Verify boundaries

```bash
pnpm nx affected -t lint --base=origin/main
```

Full walkthrough: [docs/creating-a-module.md](./docs/creating-a-module.md)

## Daily Commands

| Task                 | Command                                           |
| -------------------- | ------------------------------------------------- |
| Hot-reload dev       | `./scripts/dev.sh` (infra in Docker, app on host) |
| Start dev server     | `pnpm nx serve api`                               |
| Watch + rebuild      | `pnpm nx watch -p api -- pnpm nx run api:build`   |
| Scaffold module      | `pnpm gen:module <name>`                          |
| Scaffold composition | `pnpm gen:composition <name>`                     |
| Remove a project     | `pnpm rm:project <name>`                          |
| Run tests for module | `pnpm nx test modules-payments`                   |
| Run all tests        | `pnpm nx affected -t test --base=origin/main`     |
| Check lint           | `pnpm nx affected -t lint --base=origin/main`     |
| Create migration     | `pnpm db:migrate --name add_field`                |
| View DB              | `pnpm db:studio`                                  |
| Seed DB              | `pnpm db:seed`                                    |
| Codegen OpenAPI      | `pnpm codegen:full`                               |
| Inspect workspace    | `pnpm graph`                                      |
| Clean cache          | `pnpm clean` (reset + wipe dist/tmp)              |
| Health check         | `./scripts/doctor.sh`                             |

## Code Standards

Must follow: [docs/code-standards.md](./docs/code-standards.md)

Highlights:

- **Logging**: Use NestJS Logger via DI (Pino-backed)
- **No console.log** — structured JSON logs only
- **Error handling**: `BusinessRuleException` for domain violations; framework handles validation → RFC 9457
- **No JWT** — use session/cookie terminology instead
- **No DB mocks** — integration tests hit real Postgres via Testcontainers
- **DTOs**: one per shape; decorate with `@nestjs/swagger`
- **No TODOs in main** — ship clean

Enforced by ESLint + Lefthook + CI.

## Pull Request Checklist

- [ ] Tests added/updated (`pnpm nx test`)
- [ ] Lint pass (`pnpm nx affected -t lint --base=origin/main`)
- [ ] Build pass (`pnpm nx affected -t build --base=origin/main`)
- [ ] API docs updated (if endpoints changed)
- [ ] CHANGELOG.md updated (if user-facing)
- [ ] No TODOs in code
- [ ] Conventional commit (`feat(scope): description`)
- [ ] Module boundary respected (no cross-context imports)
- [ ] No new large dependencies

## Troubleshooting

| Issue                 | Solution                                                |
| --------------------- | ------------------------------------------------------- |
| Container won't start | `./scripts/doctor.sh` — check Docker, ports, env vars   |
| Tests timeout         | `pnpm nx reset && pnpm install && pnpm nx test`         |
| Module not found      | `pnpm nx reset && pnpm nx sync`                         |
| Stale Nx cache        | `pnpm nx reset`                                         |
| Migration fails       | `pnpm prisma migrate resolve --rolled-back <name>`      |
| Outbox stuck          | See [docs/runbook.md](./docs/runbook.md#1-outbox-stuck) |

## Getting Help

- **Architecture** → [docs/architecture.md](./docs/architecture.md)
- **Environment / API** → [docs/environment.md](./docs/environment.md), `/docs` (Scalar API reference)
- **Operations** → [docs/runbook.md](./docs/runbook.md)
- **Known issues** → [docs/troubleshooting.md](./docs/troubleshooting.md)
- **Security** → [docs/security.md](./docs/security.md)
- **AI guidance** → [CLAUDE.md](./CLAUDE.md)
- **GitHub Discussions** → [github.com/chuanghiduoc/nestjs-fastify-nx/discussions](https://github.com/chuanghiduoc/nestjs-fastify-nx/discussions)

## Releasing

Push to `main`, tag with `v*.*.*`, GitHub Actions:

- Builds each image for `linux/amd64` (multi-arch is a one-line change in `release.yml`, not the default)
- Gates on a Trivy scan **before** pushing — a fixable CRITICAL/HIGH publishes nothing
- Pushes to GHCR with SBOM + SLSA provenance attestations, then signs the digest with Cosign

The release **stops at a signed image on GHCR — it does not deploy.** Rollout is
deployment-specific and intentionally left out of CI; pull the published tag, run the migration
image against your database, then restart the services. See `docs/deployment.md`.

See `.github/workflows/release.yml` for details.
