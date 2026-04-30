import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI } from 'better-auth/plugins';
import type { PrismaClient } from '@prisma/client';

/**
 * Side-effect hooks fired after Better Auth completes a database operation.
 *
 * Kept intentionally narrow so `infra-auth` does not pull in domain modules:
 * the host app constructs the closure (e.g. publishing a domain event through
 * `EventPublisherPort`) and passes it in. Hook failures must not abort signup —
 * Better Auth has already committed the row, so we only log and move on.
 */
export interface BetterAuthHooks {
  onUserCreated?(user: { id: string; email: string }): Promise<void> | void;
}

export function createBetterAuth(prisma: PrismaClient, hooks: BetterAuthHooks = {}) {
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
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (!hooks.onUserCreated) return;
            try {
              await hooks.onUserCreated({
                id: (user as { id: string }).id,
                email: (user as { email: string }).email,
              });
            } catch (err) {
              // Signup is already committed; swallow + log so the API still
              // returns success. Downstream side-effects (welcome email) are
              // recoverable via outbox replay or operator intervention.
              console.error('[better-auth] onUserCreated hook failed', err);
            }
          },
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
