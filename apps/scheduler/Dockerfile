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
RUN pnpm nx build scheduler --configuration=development
CMD ["node", "dist/apps/scheduler/main.js"]

FROM base AS builder
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate \
    && pnpm nx sync \
    && pnpm nx build scheduler --configuration=production

FROM base AS deps
ENV NODE_ENV=production
COPY --from=builder /app/dist/apps/scheduler/package.json /app/dist/apps/scheduler/pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm prisma generate \
    && pnpm store prune

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS production
ENV NODE_ENV=production
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=deps    --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist/apps/scheduler ./dist
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-scheduler" \
      org.opencontainers.image.description="Cron scheduler (single-replica)." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

# /tmp/scheduler-alive refreshed every 30s; stale = crons stopped firing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD test -f /tmp/scheduler-alive && [ $(( $(date +%s) - $(date -r /tmp/scheduler-alive +%s) )) -lt 60 ] || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
