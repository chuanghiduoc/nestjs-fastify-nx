import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

/**
 * The three Better Auth-driven domain events are emitted by Postgres triggers, not by
 * application code, so nothing in the TypeScript test suite can cover them — they are only
 * observable against a real database.
 *
 * `users.logged_out` in particular guards a regression that is invisible in normal use and
 * expensive in production: the trigger originally fired on EVERY session delete, so the
 * scheduler's nightly expired-session purge (up to SESSION_PURGE_BATCH_SIZE x
 * SESSION_PURGE_MAX_BATCHES = 200,000 rows) and the ON DELETE CASCADE from a user
 * hard-delete both fabricated logout events. The relay claims strictly in `createdAt` order,
 * so that backlog also head-of-line blocks every real event behind it.
 */
describe('outbox triggers (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);
    prisma = new PrismaService();
    await prisma.onModuleInit();
    cleaner = new DatabaseCleaner(prisma.db);
  }, 180_000);

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await containers?.teardown();
  }, 60_000);

  beforeEach(async () => {
    await cleaner.truncateAll();
  });

  async function createUser(email: string): Promise<string> {
    const rows = await prisma.db.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO users (id, name, email, "emailVerified", role, status, "createdAt", "updatedAt")
       VALUES (uuidv7(), 'trigger probe', $1, true, 'USER', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      email,
    );
    const id = rows[0]?.id;
    // An INSERT ... RETURNING that yields no row means the trigger fixture itself is broken;
    // fail here with that explanation rather than letting `undefined` surface as an opaque
    // Postgres cast error several statements later.
    if (!id) throw new Error(`INSERT ... RETURNING produced no row for ${email}`);
    return id;
  }

  // `expiresIn` is an interval literal: a positive one is a live session, a negative one is
  // the already-expired garbage the scheduler reaps.
  async function createSession(userId: string, token: string, expiresIn: string): Promise<void> {
    await prisma.db.$executeRawUnsafe(
      `INSERT INTO sessions (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
       VALUES (uuidv7(), NOW() + $1::interval, $2, NOW(), NOW(), $3::uuid)`,
      expiresIn,
      token,
      userId,
    );
  }

  async function countEvents(eventType: string): Promise<number> {
    const rows = await prisma.db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) AS count FROM outbox_events WHERE "eventType" = $1`,
      eventType,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function clearOutbox(): Promise<void> {
    await prisma.db.$executeRawUnsafe(`DELETE FROM outbox_events`);
  }

  it('emits users.registered on insert', async () => {
    await createUser('registered@trigger.test');
    expect(await countEvents('users.registered')).toBe(1);
  });

  it('emits users.logged_in when a session is created', async () => {
    const userId = await createUser('login@trigger.test');
    await clearOutbox();
    await createSession(userId, 'login-token', '7 days');
    expect(await countEvents('users.logged_in')).toBe(1);
  });

  it('emits users.logged_out when a still-valid session is deleted (a real sign-out)', async () => {
    const userId = await createUser('signout@trigger.test');
    await createSession(userId, 'signout-token', '7 days');
    await clearOutbox();

    await prisma.db.$executeRawUnsafe(`DELETE FROM sessions WHERE token = 'signout-token'`);

    expect(await countEvents('users.logged_out')).toBe(1);
  });

  it('stays silent when the scheduler purges expired sessions', async () => {
    const userId = await createUser('purge@trigger.test');
    for (let i = 0; i < 5; i++) {
      await createSession(userId, `expired-${i}`, '-30 days');
    }
    await clearOutbox();

    // The exact statement SessionCleanupTask issues.
    await prisma.db.$executeRawUnsafe(
      `DELETE FROM sessions WHERE id IN (
         SELECT id FROM sessions WHERE "expiresAt" < NOW() - ($1 || ' days')::interval LIMIT $2
       )`,
      '1',
      1_000,
    );

    expect(await countEvents('users.logged_out')).toBe(0);
  });

  it('stays silent when sessions cascade from a user hard-delete', async () => {
    const userId = await createUser('cascade@trigger.test');
    // Live sessions — so this is isolated from the expiry predicate above and can only be
    // filtered by the parent-still-exists check.
    for (let i = 0; i < 3; i++) {
      await createSession(userId, `cascade-${i}`, '7 days');
    }
    await clearOutbox();

    await prisma.db.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId);

    expect(await countEvents('users.logged_out')).toBe(0);
  });

  it('still signs out a live session belonging to a user who has other expired ones', async () => {
    const userId = await createUser('mixed@trigger.test');
    await createSession(userId, 'mixed-live', '7 days');
    await createSession(userId, 'mixed-expired', '-30 days');
    await clearOutbox();

    await prisma.db.$executeRawUnsafe(
      `DELETE FROM sessions WHERE token IN ('mixed-live', 'mixed-expired')`,
    );

    // Exactly one: the live row, not the expired one deleted in the same statement.
    expect(await countEvents('users.logged_out')).toBe(1);
  });
});
