# syntax=docker/dockerfile:1.7
#
# Build all four apps in a single workspace pass so Nx compiles shared libs
# (libs/shared, libs/infra/*, libs/modules/*) once instead of N times.
#
# Targets: api-dev / worker-dev / scheduler-dev / migration-dev (compose.dev.yml)
#          api / worker / scheduler / migration (compose.prod.yml)

ARG NODE_VERSION=24.18.0-alpine3.24
ARG NODE_DIGEST=sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
ARG PNPM_VERSION=10.33.0

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS base
ARG PNPM_VERSION
RUN apk add --no-cache tzdata gcompat \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
WORKDIR /app

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS runtime
RUN apk add --no-cache tini tzdata gcompat \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/lib/node_modules/corepack \
              /usr/local/bin/npm /usr/local/bin/npx \
              /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
              /opt/yarn-* \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
USER appuser
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]

FROM base AS workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm fetch --frozen-lockfile
COPY package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --offline --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=nx-cache-v23,target=/app/.nx/cache \
    pnpm prisma generate \
    && node tools/docker/prisma-runtime-artifact.js export /app/.generated-prisma-runtime

# ===========================================================================
# Single build pass — every shared lib compiles once, dist/apps/* feed every
# downstream stage. `--parallel=2` keeps memory bounded on small builders.
# ===========================================================================

FROM workspace AS build-prod
ENV NODE_ENV=production \
    NX_DAEMON=false
RUN --mount=type=cache,id=nx-cache-v23,target=/app/.nx/cache \
    --mount=type=cache,id=webpack-cache,target=/app/.cache/webpack \
    pnpm nx run-many \
      --target=build \
      --projects=api,worker,scheduler,migration \
      --configuration=production \
      --parallel=2

FROM workspace AS build-dev
ENV NODE_ENV=development \
    NX_DAEMON=false
RUN --mount=type=cache,id=nx-cache-v23,target=/app/.nx/cache \
    --mount=type=cache,id=webpack-cache,target=/app/.cache/webpack \
    pnpm nx run-many \
      --target=build \
      --projects=api,worker,scheduler \
      --configuration=development \
      --parallel=2

# Dev compose needs the one-shot migration image as well, but should not pay for
# a production build of every long-running service just to produce it.
FROM workspace AS build-migration-dev
ENV NODE_ENV=production \
    NX_DAEMON=false
RUN --mount=type=cache,id=nx-cache-v23,target=/app/.nx/cache \
    --mount=type=cache,id=webpack-cache,target=/app/.cache/webpack \
    pnpm nx build migration --configuration=production

# ===========================================================================
# Dev images — single stage off build-dev. Drop privileges, keep devDeps.
# ===========================================================================

FROM base AS api-dev-deps
ENV NODE_ENV=production
COPY --from=build-dev /app/dist/apps/api/package.json /app/dist/apps/api/pnpm-lock.yaml ./
COPY --from=workspace /app/.generated-prisma-runtime /tmp/prisma-runtime
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && node /tmp/prisma-runtime/install.js install /tmp/prisma-runtime

FROM base AS worker-dev-deps
ENV NODE_ENV=production
COPY --from=build-dev /app/dist/apps/worker/package.json /app/dist/apps/worker/pnpm-lock.yaml ./
COPY --from=workspace /app/.generated-prisma-runtime /tmp/prisma-runtime
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && node /tmp/prisma-runtime/install.js install /tmp/prisma-runtime

FROM base AS scheduler-dev-deps
ENV NODE_ENV=production
COPY --from=build-dev /app/dist/apps/scheduler/package.json /app/dist/apps/scheduler/pnpm-lock.yaml ./
COPY --from=workspace /app/.generated-prisma-runtime /tmp/prisma-runtime
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && node /tmp/prisma-runtime/install.js install /tmp/prisma-runtime

FROM runtime AS api-dev
ENV NODE_ENV=development \
    PORT=3000
COPY --from=api-dev-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-dev --chown=appuser:appgroup /app/dist/apps/api ./dist
USER appuser
EXPOSE 3000 9229
CMD ["node", "dist/main.js"]

FROM runtime AS worker-dev
ENV NODE_ENV=development
COPY --from=worker-dev-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-dev --chown=appuser:appgroup /app/dist/apps/worker ./dist
USER appuser
CMD ["node", "dist/main.js"]

FROM runtime AS scheduler-dev
ENV NODE_ENV=development
COPY --from=scheduler-dev-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-dev --chown=appuser:appgroup /app/dist/apps/scheduler ./dist
USER appuser
CMD ["node", "dist/main.js"]

# ===========================================================================
# Production dependencies are pruned per service; every long-running service uses Prisma.
# ===========================================================================

FROM base AS api-deps
ENV NODE_ENV=production
COPY --from=build-prod /app/dist/apps/api/package.json /app/dist/apps/api/pnpm-lock.yaml ./
COPY --from=workspace /app/.generated-prisma-runtime /tmp/prisma-runtime
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && node /tmp/prisma-runtime/install.js install /tmp/prisma-runtime

FROM base AS worker-deps
ENV NODE_ENV=production
COPY --from=build-prod /app/dist/apps/worker/package.json /app/dist/apps/worker/pnpm-lock.yaml ./
COPY --from=workspace /app/.generated-prisma-runtime /tmp/prisma-runtime
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && node /tmp/prisma-runtime/install.js install /tmp/prisma-runtime

FROM base AS scheduler-deps
ENV NODE_ENV=production
COPY --from=build-prod /app/dist/apps/scheduler/package.json /app/dist/apps/scheduler/pnpm-lock.yaml ./
COPY --from=workspace /app/.generated-prisma-runtime /tmp/prisma-runtime
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && node /tmp/prisma-runtime/install.js install /tmp/prisma-runtime

FROM base AS migration-deps
ENV NODE_ENV=production
COPY --from=build-prod /app/dist/apps/migration/package.json /app/dist/apps/migration/pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && pnpm prisma generate

FROM base AS migration-dev-deps
ENV NODE_ENV=production
COPY --from=build-migration-dev /app/dist/apps/migration/package.json /app/dist/apps/migration/pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile --ignore-scripts \
    && pnpm prisma generate

# ===========================================================================
# Final images — slim node base, non-root, no pnpm/corepack at runtime.
# ===========================================================================

FROM runtime AS api
ENV NODE_ENV=production \
    PORT=3000
COPY --from=api-deps  --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-prod --chown=appuser:appgroup /app/dist/apps/api ./dist
USER appuser
EXPOSE 3000

LABEL org.opencontainers.image.title="nestjs-fastify-nx-api" \
      org.opencontainers.image.description="Production API service (NestJS + Fastify)." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]


FROM runtime AS worker
ENV NODE_ENV=production
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

CMD ["node", "dist/main.js"]


FROM runtime AS scheduler
ENV NODE_ENV=production
COPY --from=scheduler-deps  --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-prod --chown=appuser:appgroup /app/dist/apps/scheduler ./dist
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-scheduler" \
      org.opencontainers.image.description="Leader-elected cron scheduler." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD test -f /tmp/scheduler-alive && [ $(( $(date +%s) - $(date -r /tmp/scheduler-alive +%s) )) -lt 60 ] || exit 1

CMD ["node", "dist/main.js"]


FROM runtime AS migration
ENV NODE_ENV=production
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
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_DIRECT_URL:-$DATABASE_URL}\" node dist/main.js"]


FROM runtime AS migration-dev
ENV NODE_ENV=production
COPY --from=migration-dev-deps  --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build-migration-dev --chown=appuser:appgroup /app/dist/apps/migration ./dist
COPY --from=build-migration-dev --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=build-migration-dev --chown=appuser:appgroup /app/prisma.config.ts ./prisma.config.ts
COPY --chown=appuser:appgroup package.json ./package.json
USER appuser
CMD ["sh", "-c", "DATABASE_URL=\"${DATABASE_DIRECT_URL:-$DATABASE_URL}\" node dist/main.js"]
