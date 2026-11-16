import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import { createTestContainers } from '@nestjs-fastify-nx/testing';

it('initializes provider identity uniqueness and optional account issuers', async () => {
  const containers = await createTestContainers();
  const client = new Client({ connectionString: containers.postgres.getConnectionUri() });
  try {
    await client.connect();
    const migrations = new URL('../../../../../../prisma/migrations/', import.meta.url);
    await client.query(
      readFileSync(new URL('20260501000000_init/migration.sql', migrations), 'utf8'),
    );
    const users = await client.query<{ id: string }>(
      `INSERT INTO users (name, email, "updatedAt") VALUES ('Legacy', 'legacy@example.test', now()) RETURNING id`,
    );
    const userId = users.rows[0].id;
    await client.query(
      `INSERT INTO accounts ("accountId", issuer, "providerId", "userId", "updatedAt") VALUES ('existing', 'local:credential', 'credential', $1, now())`,
      [userId],
    );
    const legacy = await client.query(`SELECT issuer FROM accounts WHERE "accountId" = 'existing'`);
    expect(legacy.rows).toEqual([{ issuer: 'local:credential' }]);
    await client.query(
      `INSERT INTO accounts ("accountId", "providerId", "userId", "updatedAt") VALUES ('new', 'credential', $1, now()), ('new', 'google', $1, now())`,
      [userId],
    );
    await expect(
      client.query(
        `INSERT INTO accounts ("accountId", "providerId", "userId", "updatedAt") VALUES ('existing', 'credential', $1, now())`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const accounts = await client.query(`SELECT count(*)::int AS count FROM accounts`);
    expect(accounts.rows[0].count).toBe(3);
  } finally {
    await client.end();
    await containers.teardown();
  }
}, 90_000);
