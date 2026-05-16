import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI } from 'better-auth/plugins';
import type { PrismaClient } from '@prisma/client';

export function createBetterAuth(prisma: PrismaClient) {
  const secret = process.env['BETTER_AUTH_SECRET'];
  const baseURL = process.env['BETTER_AUTH_URL'];
  const trustedOrigins =
    process.env['CORS_ORIGINS']
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  return betterAuth({
    ...(secret ? { secret } : {}),
    ...(baseURL ? { baseURL } : {}),
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'USER',
          input: false,
        },
        status: {
          type: 'string',
          defaultValue: 'ACTIVE',
          input: false,
        },
      },
    },
    trustedOrigins,
    advanced: {
      // Defer to Postgres `uuidv7()` default in `prisma/schema.prisma` — the DB
      // is the single source of truth for primary keys, and v7 is sortable so
      // index locality stays B-tree friendly across high write volume.
      database: { generateId: false },
    },
    plugins: [openAPI()],
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
