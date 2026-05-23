# syntax=docker/dockerfile:1.7
#
# Build all four apps in a single workspace pass so Nx compiles shared libs
# (libs/shared, libs/infra/*, libs/modules/*) once instead of N times.
#
# Targets: api-dev / worker-dev / scheduler-dev (compose.dev.yml)
#          api / worker / scheduler / migration (compose.prod.yml)

ARG NODE_VERSION=22.22.2-alpine3.22
ARG NODE_DIGEST=sha256:b77017c37f430e4466ff497058948a2f16e8b59779600d53711eeb7b999b0f4e
ARG PNPM_VERSION=10.33.0

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS base
ARG PNPM_VERSION
RUN apk add --no-cache tzdata tini libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
WORKDIR /app

FROM base AS workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile --prefer-offline
COPY . .
RUN --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    pnpm prisma generate && pnpm nx sync

# ===========================================================================
# Single build pass — every shared lib compiles once, dist/apps/* feed every
# downstream stage. `--parallel=2` keeps memory bounded on small builders.
# ===========================================================================

FROM workspace AS build-prod
ENV NODE_ENV=production \
    NX_DAEMON=false
RUN --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    --mount=type=cache,id=webpack-cache,target=/app/.cache/webpack \
    pnpm nx run-many \
      --target=build \
      --projects=api,worker,scheduler,migration \
      --configuration=production \
      --parallel=2 \
    && node scripts/strip-generated-overrides.mjs dist/apps/api \
    && node scripts/strip-generated-overrides.mjs dist/apps/worker \
    && node scripts/strip-generated-overrides.mjs dist/apps/scheduler \
    && node scripts/strip-generated-overrides.mjs dist/apps/migration

FROM workspace AS build-dev
ENV NODE_ENV=development \
    NX_DAEMON=false
RUN --mount=type=cache,id=nx-cache,target=/app/.nx/cache \
    --mount=type=cache,id=webpack-cache,target=/app/.cache/webpack \
    pnpm nx run-many \
      --target=build \
      --projects=api,worker,scheduler \
      --configuration=development \
      --parallel=2

# ===========================================================================
# Dev images — single stage off build-dev. Drop privileges, keep devDeps.
# ===========================================================================

FROM build-dev AS api-dev
USER node
EXPOSE 3000 9229
CMD ["node", "dist/apps/api/main.js"]

FROM build-dev AS worker-dev
USER node
CMD ["node", "dist/apps/worker/main.js"]

FROM build-dev AS scheduler-dev
USER node
CMD ["node", "dist/apps/scheduler/main.js"]

# ===========================================================================
# Production deps — pruned per service so worker/migration ship no Prisma client.
# ===========================================================================

FROM base AS api-deps
ENV NODE_ENV=production
COPY --from=build-prod /app/dist/apps/api/package.json /app/dist/apps/api/pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm prisma generate \
    && pnpm store prune

FROM base AS worker-deps
ENV NODE_ENV=production
COPY --from=build-prod /app/dist/apps/worker/package.json /app/dist/apps/worker/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

FROM base AS scheduler-deps
ENV NODE_ENV=production
COPY --from=build-prod /app/dist/apps/scheduler/package.json /app/dist/apps/scheduler/pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm prisma generate \
    && pnpm store prune

FROM base AS migration-deps
ENV NODE_ENV=production
COPY --from=build-prod /app/dist/apps/migration/package.json /app/dist/apps/migration/pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# ===========================================================================
# Final images — slim node base, non-root, no pnpm/corepack at runtime.
# ===========================================================================

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS api
ENV NODE_ENV=production \
    PORT=3000
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=api-deps  --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-prod --chown=appuser:appgroup /app/dist/apps/api ./dist
COPY --from=build-prod --chown=appuser:appgroup /app/prisma ./prisma
USER appuser
EXPOSE 3000

LABEL org.opencontainers.image.title="nestjs-fastify-nx-api" \
      org.opencontainers.image.description="Production API service (NestJS + Fastify)." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

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
COPY --from=worker-deps  --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-prod --chown=appuser:appgroup /app/dist/apps/worker ./dist
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-worker" \
      org.opencontainers.image.description="BullMQ worker for background jobs." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

# Liveness file refreshed every 30s by the worker; >60s stale = stuck loop.
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
COPY --from=scheduler-deps  --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-prod --chown=appuser:appgroup /app/dist/apps/scheduler ./dist
COPY --from=build-prod --chown=appuser:appgroup /app/prisma ./prisma
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
COPY --from=migration-deps  --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-prod --chown=appuser:appgroup /app/dist/apps/migration ./dist
COPY --from=build-prod --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=build-prod --chown=appuser:appgroup /app/prisma.config.ts ./prisma.config.ts
COPY --chown=appuser:appgroup package.json ./package.json
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-migration" \
      org.opencontainers.image.description="One-shot Prisma migrate + optional admin seed." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

# DDL is session-scoped — bypass transaction-mode poolers via DATABASE_DIRECT_URL.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_DIRECT_URL:-$DATABASE_URL}\" node dist/main.js"]
