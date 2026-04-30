# syntax=docker/dockerfile:1.7

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

FROM base AS development
ENV NODE_ENV=development
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate && pnpm nx sync
RUN pnpm nx build worker --configuration=development
CMD ["node", "dist/apps/worker/main.js"]

FROM base AS builder
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate \
    && pnpm nx sync \
    && pnpm nx build worker --configuration=production

# No Prisma — worker speaks Redis (BullMQ) + SMTP only.
FROM base AS deps
ENV NODE_ENV=production
COPY --from=builder /app/dist/apps/worker/package.json /app/dist/apps/worker/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS production
ENV NODE_ENV=production
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=deps    --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist/apps/worker ./dist
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-worker" \
      org.opencontainers.image.description="BullMQ worker for background jobs." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

# /tmp/worker-alive refreshed every 30s; >60s stale = stuck loop or dead Redis.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD test -f /tmp/worker-alive && [ $(( $(date +%s) - $(date -r /tmp/worker-alive +%s) )) -lt 60 ] || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
