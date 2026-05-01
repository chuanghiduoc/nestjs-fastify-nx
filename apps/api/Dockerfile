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
RUN pnpm nx build api --configuration=development \
    && chown -R node:node /app
USER node
EXPOSE 3000 9229
CMD ["node", "dist/apps/api/main.js"]

FROM base AS builder
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma generate \
    && pnpm nx sync \
    && pnpm nx build api --configuration=production

# Pruned manifest from webpack generatePackageJson — tslib via runtimeDependencies.
FROM base AS deps
ENV NODE_ENV=production
COPY --from=builder /app/dist/apps/api/package.json /app/dist/apps/api/pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile \
    && pnpm prisma generate \
    && pnpm store prune

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS production
ENV NODE_ENV=production \
    PORT=3000
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=deps    --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist/apps/api ./dist
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
USER appuser
EXPOSE 3000

LABEL org.opencontainers.image.title="nestjs-fastify-nx-api" \
      org.opencontainers.image.description="Production API service (NestJS + Fastify)." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

# Node http instead of wget — fewer binaries, smaller CVE surface.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
