import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from 'pg';
import {
  createTestContainers,
  deployTestMigrations,
  provisionRlsRole,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';

const ORG_A = '01900000-0000-7000-8000-00000000a201';
const ORG_B = '01900000-0000-7000-8000-00000000b201';
const LOG_A = '01900000-0000-7000-8000-00000000a203';
const LOG_B = '01900000-0000-7000-8000-00000000b203';
const LOG_C = '01900000-0000-7000-8000-00000000c203';
const FUTURE_MONTH_OFFSET = "INTERVAL '6 months'";

const INSERT_AUDIT_LOG_SQL = `INSERT INTO audit_logs (id, "organizationId", action, metadata)
  VALUES ($1, $2, 'organization.updated', '{}'::jsonb)`;

async function currentPartition(admin: Client): Promise<string> {
  const { rows } = await admin.query<{ name: string }>(
    `SELECT 'audit_logs_' || to_char(NOW() AT TIME ZONE 'UTC', 'YYYY_MM') AS name`,
  );
  return rows[0].name;
}

async function auditLogPartitions(admin: Client): Promise<{ name: string; rls: boolean }[]> {
  const { rows } = await admin.query<{ name: string; rls: boolean }>(
    `SELECT child.relname AS name, child.relrowsecurity AS rls
       FROM pg_inherits i
       JOIN pg_class child ON child.oid = i.inhrelid
      WHERE i.inhparent = 'audit_logs'::regclass
      ORDER BY child.relname`,
  );
  return rows;
}

async function asOrganization<R>(
  client: Client,
  organizationId: string,
  fn: () => Promise<R>,
): Promise<R> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [organizationId]);
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

describe('audit_logs partition tenant isolation (integration)', () => {
  let containers: TestContainers;
  let admin: Client;
  let tenant: Client;
  let partition: string;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    deployTestMigrations(dbUrl);

    admin = new Client({ connectionString: dbUrl });
    await admin.connect();
    partition = await currentPartition(admin);

    tenant = new Client({ connectionString: await provisionRlsRole(dbUrl) });
    await tenant.connect();
  }, 120_000);

  afterAll(async () => {
    await tenant?.end();
    await admin?.end();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await admin.query('TRUNCATE audit_logs, organizations RESTART IDENTITY CASCADE');
    await admin.query(
      `INSERT INTO organizations (id, name, slug) VALUES ($1, 'A', 'audit-org-a'), ($2, 'B', 'audit-org-b')`,
      [ORG_A, ORG_B],
    );
    await admin.query(INSERT_AUDIT_LOG_SQL, [LOG_A, ORG_A]);
    await admin.query(INSERT_AUDIT_LOG_SQL, [LOG_B, ORG_B]);
  });

  it('enables row-level security on every seeded partition', async () => {
    const partitions = await auditLogPartitions(admin);

    expect(partitions.length).toBeGreaterThan(0);
    expect(partitions.filter((row) => !row.rls)).toEqual([]);
  });

  it('enables row-level security on a partition created later by the scheduler function', async () => {
    await admin.query(`SELECT ensure_audit_log_partition(NOW() + ${FUTURE_MONTH_OFFSET})`);

    expect((await auditLogPartitions(admin)).filter((row) => !row.rls)).toEqual([]);
  });

  it('re-enables row-level security on an existing partition that lost it', async () => {
    await admin.query(`ALTER TABLE "${partition}" DISABLE ROW LEVEL SECURITY`);

    await admin.query('SELECT ensure_audit_log_partition(NOW())');

    expect((await auditLogPartitions(admin)).filter((row) => !row.rls)).toEqual([]);
  });

  it('still returns only the organization in context through the parent table', async () => {
    const rows = await asOrganization(tenant, ORG_A, async () => {
      const result = await tenant.query('SELECT id FROM audit_logs');
      return result.rows;
    });

    expect(rows).toEqual([{ id: LOG_A }]);
  });

  it('still records a row for the organization in context through the parent table', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    await tenant.query(INSERT_AUDIT_LOG_SQL, [LOG_C, ORG_A]);
    await tenant.query('COMMIT');

    const { rows } = await admin.query('SELECT id FROM audit_logs WHERE id = $1', [LOG_C]);
    expect(rows).toHaveLength(1);
  });

  it('cannot read another organization by querying the partition directly', async () => {
    const rows = await asOrganization(tenant, ORG_A, async () => {
      const result = await tenant.query(`SELECT id FROM "${partition}"`);
      return result.rows;
    });

    expect(rows).toEqual([]);
  });

  it('cannot update another organization by querying the partition directly', async () => {
    const changed = await asOrganization(tenant, ORG_A, async () => {
      const result = await tenant.query(
        `UPDATE "${partition}" SET action = 'tampered' WHERE id = $1`,
        [LOG_B],
      );
      return result.rowCount;
    });

    expect(changed).toBe(0);
  });

  it('cannot delete another organization by querying the partition directly', async () => {
    const deleted = await asOrganization(tenant, ORG_A, async () => {
      const result = await tenant.query(`DELETE FROM "${partition}" WHERE id = $1`, [LOG_B]);
      return result.rowCount;
    });

    expect(deleted).toBe(0);
  });

  it('cannot forge a row for another organization by inserting into the partition directly', async () => {
    await expect(
      asOrganization(tenant, ORG_A, () =>
        tenant.query(
          `INSERT INTO "${partition}" (id, "organizationId", action, metadata)
           VALUES ($1, $2, 'organization.updated', '{}'::jsonb)`,
          [LOG_C, ORG_B],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
