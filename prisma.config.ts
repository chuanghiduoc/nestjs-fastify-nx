import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 stops auto-loading .env once a prisma.config.ts exists. loadEnvFile
// never overrides already-set vars, so the containerised path (no .env file)
// is untouched.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// Driver adapter (PrismaPg) is configured at runtime in PrismaService,
// not here — `adapter` is not a valid PrismaConfig field in Prisma 7.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prefer DATABASE_DIRECT_URL when set to a non-empty value — migrations
    // need a direct Postgres connection (DDL is session-scoped, breaks under
    // transaction-mode poolers). Falls back to DATABASE_URL otherwise.
    // `||` is intentional: ?? would let an empty `DATABASE_DIRECT_URL=` in
    // .env short-circuit before the fallback.
    // Do NOT add `directUrl` to schema.prisma — Prisma 7 deprecated it.
    url: process.env['DATABASE_DIRECT_URL'] || process.env['DATABASE_URL'] || '',
  },
});
