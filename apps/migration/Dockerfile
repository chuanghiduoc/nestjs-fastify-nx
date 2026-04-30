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

# Explicit `prisma generate` — postinstall hook only runs when schema is at the
# default lookup path, which differs across pnpm install modes.
FROM base AS deps
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --prod --frozen-lockfile
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN pnpm prisma generate \
    && pnpm store prune

FROM node:${NODE_VERSION}@${NODE_DIGEST} AS production
ENV NODE_ENV=production
# Calls prisma binary directly — no corepack at runtime, no registry round-trip
# on cold start (matters in firewalled prod networks).
RUN apk add --no-cache tini tzdata libc6-compat \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=deps --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=deps --chown=appuser:appgroup /app/prisma.config.ts ./prisma.config.ts
COPY --chown=appuser:appgroup package.json ./package.json
USER appuser

LABEL org.opencontainers.image.title="nestjs-fastify-nx-migration" \
      org.opencontainers.image.description="One-shot Prisma migrate + optional admin seed." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="nestjs-fastify-nx"

# RUN_SEED gates seed.mjs so routine deploys never touch user data.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && { [ \"${RUN_SEED:-false}\" = \"true\" ] && node prisma/seed.mjs || echo '[migration] RUN_SEED!=true — skipping seed'; }"]
