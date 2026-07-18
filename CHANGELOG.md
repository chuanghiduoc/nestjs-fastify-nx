## 1.1.0 (2026-07-18)

### Features

- integrate code-review-graph mcp server with hooks and skills ([3bceaf6](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/3bceaf6))
- scalar docs, nestjs-i18n, build-prod auto-up ([7d898a1](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/7d898a1))
- harden boilerplate with cqrs bus, structured logging, and resilience ([#82](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/82))
- harden dev workflow, add social login, and dx tooling ([#88](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/88))
- ts7 toolchain, observability (cls + cqrs tracing), committed api-client, docker + docs ([#89](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/89))
- add DATABASE_LOG_QUERIES for full query debugging in dev ([#104](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/104))
- **api:** adopt stripe-style + rfc 9457 response contract ([400e36e](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/400e36e))
- **api:** production hardening pass ([890f503](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/890f503))
- **api:** add idempotency-key replay and request-timeout guards ([#90](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/90))
- **config:** add trust-proxy/ws-cap/throttler-fail-open vars and lower sentry default ([c88e665](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/c88e665))
- **db:** index and constraint hardening ([3a9d6bb](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/3a9d6bb))
- **docker:** add swarm overlay for multi-host deployment ([d5467a8](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/d5467a8))
- **graphql:** block schema introspection in production ([2ef1eb8](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/2ef1eb8))
- **observability:** harden tracing, metrics ownership, health probes + local stack ([#96](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/96))
- **scaling:** horizontal scaling primitives ([#43](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/43))
- **scheduler:** warn when any dlq exceeds threshold ([a79dbb0](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/a79dbb0))
- **scripts:** build-dev service filter, build report, and lf line endings ([a7f8d8b](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/a7f8d8b))
- **shared:** add typed env reader helpers ([e5a6f8f](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/e5a6f8f))
- **ws:** per-ip connection cap and explicit session expiry check ([9c75f72](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/9c75f72))

### Bug Fixes

- swc es2022 target, faster local builds, docker-smoke CI, deploy-agnostic ports ([#58](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/58))
- remediate deep code-audit findings (6 high + 9 medium) ([#59](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/59))
- harden system reliability and delivery ([9af562e](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/9af562e))
- codebase audit — resilience, contracts, and doc accuracy ([#103](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/103))
- drop the obsolete prisma runtime artifact from the docker build ([#107](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/107))
- **api:** emit problem details on fastify errors and standardize pagination naming ([9e3aef9](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/9e3aef9))
- **api:** document liveness probe error responses in swagger ([f158a3c](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/f158a3c))
- **api:** use /health/live for container healthcheck and size memory to container limit ([670c47b](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/670c47b))
- **api:** drive trustproxy from env and tighten dev cors allowlist ([6091220](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/6091220))
- **api:** pin /metrics to VERSION_NEUTRAL and swap bullmq probe to getJobCounts ([#48](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/48))
- **auth:** timing-safe bull-board credentials and explicit session expiry check ([2b5e7ca](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/2b5e7ca))
- **deps:** pin kysely>=0.28.17 via pnpm override to patch GHSA-pv5w-4p9q-p3v2 ([8c1db35](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/8c1db35))
- **deps:** floor undici to 8.5.0 ([#65](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/65))
- **deps:** cap js-yaml at v4, drop unused @fastify/static, block typescript 7 major ([#95](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/95))
- **docker:** stop exposing data-tier ports and bind api to loopback in prod overlay ([34a6d4d](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/34a6d4d))
- **scripts:** build-dev smoke test no longer hangs on dual-stack hosts ([72fabf4](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/72fabf4))
- **security:** clear semgrep findings + harden release workflow ([1d52eda](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/1d52eda))
- **test:** set database url default in vitest.setup for app-module specs ([585c1a4](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/585c1a4))
- **throttler:** fail open when redis storage is unreachable ([f208432](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/f208432))
- **upload:** verify magic bytes inline on confirm ([cca31e2](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/cca31e2))

### Performance

- build apps with swc compiler instead of tsc ([#57](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/57))
- **docker:** unify api/worker/scheduler into one image build with shared workspace stage ([e0bbd27](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/e0bbd27))
- **scripts:** make build-dev incremental by default ([86a75ad](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/86a75ad))

### Refactors

- monorepo best-practice overhaul (phases 1-10) ([#36](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/36))
- dedupe env parsing via shared env-readers ([8b87a3c](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/8b87a3c))
- migrate off deprecated zod and terminus apis ([#102](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/102))
- type the CQRS bus overrides with unknown instead of any ([#105](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/105))
- migrate prisma to the prisma-client generator ([#106](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/106))
- **api:** redeclare schema type locally to drop @nestjs/swagger deep import ([c0b70a4](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/c0b70a4))
- **db:** fold fk indexes and user constraints into the init migration ([3e4c986](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/3e4c986))
- **messaging:** release outbox claim transaction before publish ([8ffe748](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/8ffe748))

### Documentation

- clarify outbox dual-write paths and metrics swagger exclusion ([66e1092](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/66e1092))
- add mermaid architecture diagrams ([105eb32](https://github.com/chuanghiduoc/nestjs-fastify-nx/commit/105eb32))

### Build System

- optimize deployment artifacts and images ([#100](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/100))
- upgrade to pnpm 11 ([#110](https://github.com/chuanghiduoc/nestjs-fastify-nx/pull/110))
