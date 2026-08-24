import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Client } from 'pg';
import { ClsService } from 'nestjs-cls';
import { createTestContainers, deployTestMigrations } from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { REQUEST_CONTEXT_KEYS, type RequestContextStore } from '@nestjs-fastify-nx/core';
import { PrismaStoredFileRepository } from './prisma-stored-file.repository';

const ORG_A = '01900000-0000-7000-8000-00000000a001';
const ORG_B = '01900000-0000-7000-8000-00000000b001';
const USER_A = '01900000-0000-7000-8000-00000000a002';
const USER_B = '01900000-0000-7000-8000-00000000b002';

const RLS_ROLE = 'app_request_probe';
const RLS_PASSWORD = 'probe-password';

async function seedTenants(admin: Client): Promise<void> {
  await admin.query(
    `INSERT INTO users (id, name, email, "updatedAt") VALUES
       ($1, 'A', 'a@test.local', NOW()),
       ($2, 'B', 'b@test.local', NOW())`,
    [USER_A, USER_B],
  );
  await admin.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'A', 'org-a'), ($2, 'B', 'org-b')`,
    [ORG_A, ORG_B],
  );
  await admin.query(
    `INSERT INTO stored_files (id, "organizationId", "userId", "sourceKey", "key", bucket, "contentType", size, etag, status, "updatedAt") VALUES
       ('01900000-0000-7000-8000-00000000a003', $1, $3, 'src/a', 'files/a', 'b', 'image/png', 1, 'ea', 'READY', NOW()),
       ('01900000-0000-7000-8000-00000000b003', $2, $4, 'src/b', 'files/b', 'b', 'image/png', 1, 'eb', 'READY', NOW())`,
    [ORG_A, ORG_B, USER_A, USER_B],
  );
}

describe('stored_files tenant isolation (integration)', () => {
  let containers: TestContainers;
  let admin: Client;
  let tenant: Client;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    deployTestMigrations(dbUrl);

    admin = new Client({ connectionString: dbUrl });
    await admin.connect();

    await admin.query(`DROP ROLE IF EXISTS ${RLS_ROLE}`);
    await admin.query(
      `CREATE ROLE ${RLS_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${RLS_PASSWORD}'`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RLS_ROLE}`,
    );

    const url = new URL(dbUrl);
    url.username = RLS_ROLE;
    url.password = RLS_PASSWORD;
    tenant = new Client({ connectionString: url.toString() });
    await tenant.connect();
  }, 120_000);

  afterAll(async () => {
    await tenant?.end();
    await admin?.end();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await admin.query('TRUNCATE stored_files, organizations, users RESTART IDENTITY CASCADE');
    await seedTenants(admin);
  });

  it('is not superuser, so row-level security actually applies', async () => {
    const { rows } = await tenant.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('returns nothing when no organization context is set', async () => {
    const { rows } = await tenant.query('SELECT id FROM stored_files');
    expect(rows).toHaveLength(0);
  });

  it('returns only the rows of the organization in context', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const { rows } = await tenant.query('SELECT key FROM stored_files');
    await tenant.query('COMMIT');

    expect(rows).toEqual([{ key: 'files/a' }]);
  });

  it('cannot read another organization by guessing its id', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const { rows } = await tenant.query(
      'SELECT key FROM stored_files WHERE "organizationId" = $1',
      [ORG_B],
    );
    await tenant.query('COMMIT');

    expect(rows).toHaveLength(0);
  });

  it('cannot write a row into another organization', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);

    await expect(
      tenant.query(
        `INSERT INTO stored_files (id, "organizationId", "userId", "sourceKey", "key", bucket, "contentType", size, etag, status, "updatedAt")
         VALUES ('01900000-0000-7000-8000-00000000c003', $1, $2, 'src/c', 'files/c', 'b', 'image/png', 1, 'ec', 'READY', NOW())`,
        [ORG_B, USER_A],
      ),
    ).rejects.toThrow(/row-level security/i);

    await tenant.query('ROLLBACK');
  });

  it('cannot move an owned row into another organization', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);

    await expect(
      tenant.query('UPDATE stored_files SET "organizationId" = $1 WHERE "key" = $2', [
        ORG_B,
        'files/a',
      ]),
    ).rejects.toThrow(/row-level security/i);

    await tenant.query('ROLLBACK');
  });

  it('cannot delete another organization row', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const result = await tenant.query('DELETE FROM stored_files WHERE "key" = $1', ['files/b']);
    await tenant.query('COMMIT');

    expect(result.rowCount).toBe(0);

    const { rows } = await admin.query('SELECT key FROM stored_files ORDER BY key');
    expect(rows).toEqual([{ key: 'files/a' }, { key: 'files/b' }]);
  });

  it('drops the context at transaction end so a leaked connection sees nothing', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    await tenant.query('COMMIT');

    const { rows } = await tenant.query('SELECT id FROM stored_files');
    expect(rows).toHaveLength(0);
  });

  describe('PrismaStoredFileRepository under the RLS role', () => {
    let cls: ClsService<RequestContextStore>;
    let prisma: PrismaService;
    let repository: PrismaStoredFileRepository;
    let previousDatabaseUrl: string | undefined;

    beforeAll(async () => {
      const url = new URL(containers.postgres.getConnectionUri());
      url.username = RLS_ROLE;
      url.password = RLS_PASSWORD;

      previousDatabaseUrl = process.env['DATABASE_URL'];
      process.env['DATABASE_URL'] = url.toString();

      cls = new ClsService<RequestContextStore>(new AsyncLocalStorage());
      prisma = new PrismaService(cls);
      await prisma.onModuleInit();
      repository = new PrismaStoredFileRepository(prisma);
    }, 60_000);

    afterAll(async () => {
      await prisma?.onModuleDestroy();
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = previousDatabaseUrl;
    });

    const asOrganization = <R>(organizationId: string, fn: () => Promise<R>): Promise<R> =>
      cls.run(() => {
        cls.set(REQUEST_CONTEXT_KEYS.organizationId, organizationId);
        return fn();
      });

    it('reads its own organization row through the repository', async () => {
      const found = await asOrganization(ORG_A, () => repository.findByKey('files/a'));
      expect(found?.organizationId).toBe(ORG_A);
    });

    it('cannot read another organization row through the repository', async () => {
      const found = await asOrganization(ORG_A, () => repository.findByKey('files/b'));
      expect(found).toBeNull();
    });

    it('cannot transition another organization row', async () => {
      const changed = await asOrganization(ORG_A, () =>
        repository.transitionByKey('files/b', 'READY', 'REJECTED'),
      );
      expect(changed).toBe(false);

      const { rows } = await admin.query('SELECT status FROM stored_files WHERE "key" = $1', [
        'files/b',
      ]);
      expect(rows[0].status).toBe('READY');
    });

    it('refuses tenant-scoped access when no organization is in context', async () => {
      await expect(repository.findByKey('files/a')).resolves.toBeNull();
    });
  });
});
