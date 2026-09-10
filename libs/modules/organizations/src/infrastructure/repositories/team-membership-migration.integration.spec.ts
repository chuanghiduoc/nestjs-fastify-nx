import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import { createTestContainers } from '@nestjs-fastify-nx/testing';

it('upgrades legacy team memberships without losing rows and backfills counters', async () => {
  const containers = await createTestContainers();
  const client = new Client({ connectionString: containers.postgres.getConnectionUri() });
  try {
    await client.connect();
    const migrations = new URL('../../../../../../prisma/migrations/', import.meta.url);
    await client.query(
      readFileSync(new URL('20260501000000_init/migration.sql', migrations), 'utf8'),
    );
    const org = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('Legacy', 'legacy') RETURNING id`,
    );
    const users = await client.query<{ id: string }>(
      `INSERT INTO users (name, email, "updatedAt") VALUES ('One', 'one@legacy.local', now()), ('Two', 'two@legacy.local', now()) RETURNING id`,
    );
    const teams = await client.query<{ id: string }>(
      `INSERT INTO teams (name, "organizationId") VALUES ('Populated', $1), ('Empty', $1) RETURNING id`,
      [org.rows[0].id],
    );
    await client.query(`INSERT INTO team_members ("teamId", "userId") VALUES ($1, $2), ($1, $3)`, [
      teams.rows[0].id,
      users.rows[0].id,
      users.rows[1].id,
    ]);
    await client.query(
      readFileSync(
        new URL('20260910000000_better_auth_team_membership/migration.sql', migrations),
        'utf8',
      ),
    );
    const counts = await client.query<{ name: string; memberCount: number }>(
      `SELECT name, "memberCount" FROM teams ORDER BY name`,
    );
    expect(counts.rows).toEqual([
      { name: 'Empty', memberCount: 0 },
      { name: 'Populated', memberCount: 2 },
    ]);
    const members = await client.query<{ membershipKey: string | null }>(
      `SELECT "membershipKey" FROM team_members`,
    );
    expect(members.rows).toEqual([{ membershipKey: null }, { membershipKey: null }]);
    await client.query(
      `UPDATE team_members SET "membershipKey" = 'unique-key' WHERE "userId" = $1`,
      [users.rows[0].id],
    );
    await expect(
      client.query(`UPDATE team_members SET "membershipKey" = 'unique-key' WHERE "userId" = $1`, [
        users.rows[1].id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  } finally {
    await client.end();
    await containers.teardown();
  }
}, 90_000);
