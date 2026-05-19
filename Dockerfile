# syntax=docker/dockerfile:1.7
#
# Unified workspace Dockerfile for api / worker / scheduler / migration.
# A single `workspace` stage runs `pnpm install`, copies the source, and runs
# `prisma generate` + `nx sync` once — every per-service builder branches off
# that stage so BuildKit reuses the heavy layers across all four images.
#
# Build targets:
#   api-dev / worker-dev / scheduler-dev       → docker/compose.dev.yml
#   api / worker / scheduler / migration       → docker/compose.prod.yml
#
# Override at build time:
#   docker buildx build --target api-dev -f Dockerfile .

ARG NODE_VERSION=22.22.2-alpine3.22
ARG NODE_DIGEST=sha256:b77017c37f430e4466ff497058948a2f16e8b59779600d53711eeb7b999b0f4e
ARG PNPM_VERSION=10.33.0

# ---------------------------------------------------------------------------
# Shared base — pnpm + tini + tz, reused by every downstream stage.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}@${NODE_DIGEST} AS base
ARG PNPM_VERSION
RUN apk add --no-cache tzdata tini libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
WORKDIR /app

# ---------------------------------------------------------------------------
# Single workspace stage — install + source + prisma generate + nx sync.
# Branched into 6 per-service builders below so this work runs once per build.
# ---------------------------------------------------------------------------
FROM base AS workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
# pnpm-store: reuses downloaded tarballs across rebuilds (warm = ~10s vs ~60s cold).
# --prefer-offline resolves from store without a network round-trip when cache is warm.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile --prefer-offline
COPY . .
# nx-cache: persists Nx computation cache across image rebuilds so unchanged
# projects are not re-compiled on every docker build invocation.
RUN --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm prisma generate && pnpm nx sync

# ===========================================================================
# DEV TARGETS — used by docker/compose.dev.yml. Single layer per service:
# `nx build` then drop privileges. No deps prune, no slim runtime.
# ===========================================================================

FROM workspace AS api-dev
ENV NODE_ENV=development
# webpack-cache: persists incremental webpack build artifacts; eliminates full
# recompile when only application source changes (not deps or tsconfig).
RUN --mount=type=cache,id=webpack-cache-api,target=/app/.cache/webpack \
    --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm nx build api --configuration=development
USER node
EXPOSE 3000 9229
CMD ["node", "dist/apps/api/main.js"]

FROM workspace AS worker-dev
ENV NODE_ENV=development
RUN --mount=type=cache,id=webpack-cache-worker,target=/app/.cache/webpack \
    --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm nx build worker --configuration=development
USER node
CMD ["node", "dist/apps/worker/main.js"]

FROM workspace AS scheduler-dev
ENV NODE_ENV=development
RUN --mount=type=cache,id=webpack-cache-scheduler,target=/app/.cache/webpack \
    --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm nx build scheduler --configuration=development
USER node
CMD ["node", "dist/apps/scheduler/main.js"]

# ===========================================================================
# PRODUCTION BUILDERS — emit dist/apps/<svc>/{main.js,package.json,pnpm-lock.yaml}
# via webpack generatePackageJson. Each consumes the shared workspace stage.
# ===========================================================================

FROM workspace AS api-builder
ENV NODE_ENV=production
RUN --mount=type=cache,id=webpack-cache-api,target=/app/.cache/webpack \
    --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm nx build api --configuration=production \
    && node scripts/strip-generated-overrides.mjs dist/apps/api

FROM workspace AS worker-builder
ENV NODE_ENV=production
RUN --mount=type=cache,id=webpack-cache-worker,target=/app/.cache/webpack \
    --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm nx build worker --configuration=production \
    && node scripts/strip-generated-overrides.mjs dist/apps/worker

FROM workspace AS scheduler-builder
ENV NODE_ENV=production
RUN --mount=type=cache,id=webpack-cache-scheduler,target=/app/.cache/webpack \
    --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm nx build scheduler --configuration=production \
    && node scripts/strip-generated-overrides.mjs dist/apps/scheduler

FROM workspace AS migration-builder
ENV NODE_ENV=production
RUN --mount=type=cache,id=webpack-cache-migration,target=/app/.cache/webpack \
    --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm nx build migration --configuration=production \
    && node scripts/strip-generated-overrides.mjs dist/apps/migration

# ---------------------------------------------------------------------------
# Production deps — pruned, --prod only. api + scheduler ship prisma client;
# worker has no DB; migration ships prisma CLI but skips client generate.
# ---------------------------------------------------------------------------
FROM base AS api-deps
ENV NODE_ENV=production
COPY --from=api-builder /app/dist/apps/api/package.json /app/dist/apps/api/pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm prisma generate \
    && pnpm store prune

FROM base AS worker-deps
ENV NODE_ENV=production
COPY --from=worker-builder /app/dist/apps/worker/package.json /app/dist/apps/worker/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

FROM base AS scheduler-deps
ENV NODE_ENV=production
COPY --from=scheduler-builder /app/dist/apps/scheduler/package.json /app/dist/apps/scheduler/pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm prisma generate \
    && pnpm store prune

FROM base AS migration-deps
ENV NODE_ENV=production
COPY --from=migration-builder /app/dist/apps/migration/package.json /app/dist/apps/migration/pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
# Migration runs `prisma migrate deploy` which uses the migration engine
# directly — no `@prisma/client` generation needed.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# ===========================================================================
# PRODUCTION FINAL IMAGES — slim node base, non-root appuser, no pnpm/corepack.
# Use Node http for healthcheck on api (smaller CVE surface than wget).
# ===========================================================================

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS api
ENV NODE_ENV=production \
    PORT=3000
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=api-deps    --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=api-builder --chown=appuser:appgroup /app/dist/apps/api ./dist
COPY --from=api-builder --chown=appuser:appgroup /app/prisma ./prisma
USER appuser
EXPOSE 3000

LABEL org.opencontainers.image.title="nestjs-fastify-nx-api" \
      org.opencontainers.image.description="Production API service (NestJS + Fastify)." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/v1/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]


FROM node:${NODE_VERSION}@${NODE_DIGEST} AS worker
ENV NODE_ENV=production
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=worker-deps    --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=worker-builder --chown=appuser:appgroup /app/dist/apps/worker ./dist
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-worker" \
      org.opencontainers.image.description="BullMQ worker for background jobs." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

# Liveness file refreshed every 30s; >60s stale = stuck loop or dead Redis.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD test -f /tmp/worker-alive && [ $(( $(date +%s) - $(date -r /tmp/worker-alive +%s) )) -lt 60 ] || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]


FROM node:${NODE_VERSION}@${NODE_DIGEST} AS scheduler
ENV NODE_ENV=production
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=scheduler-deps    --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=scheduler-builder --chown=appuser:appgroup /app/dist/apps/scheduler ./dist
COPY --from=scheduler-builder --chown=appuser:appgroup /app/prisma ./prisma
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-scheduler" \
      org.opencontainers.image.description="Cron scheduler (single-replica)." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD test -f /tmp/scheduler-alive && [ $(( $(date +%s) - $(date -r /tmp/scheduler-alive +%s) )) -lt 60 ] || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]


FROM node:${NODE_VERSION}@${NODE_DIGEST} AS migration
ENV NODE_ENV=production
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=migration-deps    --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=migration-builder --chown=appuser:appgroup /app/dist/apps/migration ./dist
COPY --from=migration-builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=migration-builder --chown=appuser:appgroup /app/prisma.config.ts ./prisma.config.ts
COPY --chown=appuser:appgroup package.json ./package.json
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-migration" \
      org.opencontainers.image.description="One-shot Prisma migrate + optional admin seed." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

# Prisma migrate deploy needs a direct Postgres connection (DDL is session-
# scoped). When a transaction-mode pooler fronts the DB, DATABASE_DIRECT_URL
# bypasses it. Falls back to DATABASE_URL when no pooler is in use.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_DIRECT_URL:-$DATABASE_URL}\" node dist/main.js"]
