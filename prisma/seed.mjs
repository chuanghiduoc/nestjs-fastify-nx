// @ts-check

/**
 * Better Auth stores credentials in `accounts.password` (provider="credential",
 * accountId=user.id) using its own scrypt-based hash. The on-disk format must
 * be produced by `hashPassword` from `better-auth/crypto` — any other hasher
 * (e.g. argon2) yields output that Better Auth's signin path cannot verify.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from 'better-auth/crypto';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('[seed] DATABASE_URL is not set — aborting.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env['SEED_ADMIN_EMAIL'];
  const password = process.env['SEED_ADMIN_PASSWORD'];

  if (!email || !password) {
    console.log('[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] Admin ${email} already exists — skipping.`);
    return;
  }

  const passwordHash = await hashPassword(password);

  // Create the user row + linked credential account in a single transaction
  // so a partial seed never leaves an orphaned user with no signin path.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        emailVerified: true,
        name: 'Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: passwordHash,
      },
    });
  });

  console.log(`[seed] Admin user ${email} created successfully.`);
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
