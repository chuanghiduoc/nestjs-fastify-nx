// @ts-check

/**
 * Better Auth stores credentials in `accounts.password` (provider="credential",
 * accountId=user.id) using its own scrypt-based hash. The on-disk format must
 * be produced by `hashPassword` from `better-auth/crypto` — any other hasher
 * (e.g. argon2) yields output that Better Auth's signin path cannot verify.
 *
 * This seed talks to Postgres through the `pg` driver directly rather than the
 * Prisma Client. The Prisma 7 `prisma-client` generator emits the client as
 * TypeScript into `libs/infra/database/src/generated`, but the migration image
 * that runs this script (`node prisma/seed.mjs`) is a pruned, bundle-only image
 * — it carries `dist/apps/migration` + `prisma/` but not `libs/`, so the
 * generated client is simply not present at runtime. `pg` and `better-auth` are
 * declared as seed runtime deps (see apps/migration/webpack.config.js) and are
 * installed in the image, so raw SQL is the dependency-safe path here. `id`
 * defaults to a database-generated UUIDv7, so nothing here needs the ORM.
 */

import { Client } from 'pg';
import { hashPassword } from 'better-auth/crypto';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('[seed] DATABASE_URL is not set — aborting.');
  process.exit(1);
}

const client = new Client({ connectionString: url });

async function main() {
  const email = process.env['SEED_ADMIN_EMAIL'];
  const password = process.env['SEED_ADMIN_PASSWORD'];

  if (!email || !password) {
    console.log('[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping.');
    return;
  }

  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount && existing.rowCount > 0) {
    console.log(`[seed] Admin ${email} already exists — skipping.`);
    return;
  }

  const passwordHash = await hashPassword(password);

  // Create the user row + linked credential account in a single transaction
  // so a partial seed never leaves an orphaned user with no signin path.
  // `id` defaults to uuidv7() in the database; `updatedAt` is Prisma's
  // application-managed `@updatedAt`, so it has no DB default and is set here.
  await client.query('BEGIN');
  try {
    const userResult = await client.query(
      `INSERT INTO users (email, "emailVerified", name, role, status, "updatedAt")
       VALUES ($1, true, 'Admin', 'ADMIN', 'ACTIVE', now())
       RETURNING id`,
      [email],
    );
    const userId = userResult.rows[0].id;

    await client.query(
      `INSERT INTO accounts ("userId", "accountId", "providerId", password, "updatedAt")
       VALUES ($1, $2, 'credential', $3, now())`,
      [userId, userId, passwordHash],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  console.log(`[seed] Admin user ${email} created successfully.`);
}

client
  .connect()
  .then(main)
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(() => client.end());
