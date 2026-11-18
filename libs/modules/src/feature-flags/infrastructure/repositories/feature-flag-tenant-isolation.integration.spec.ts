import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Client } from 'pg';
import { ClsService } from 'nestjs-cls';
import {
  createTestContainers,
  deployTestMigrations,
  provisionRlsRole,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { REQUEST_CONTEXT_KEYS, type RequestContextStore } from '@nestjs-fastify-nx/core';
import { FeatureFlag } from '../../domain/entities/feature-flag.entity';
import { PrismaFeatureFlagRepository } from './prisma-feature-flag.repository';

const ORG_A = '01900000-0000-7000-8000-00000000a201';
const ORG_B = '01900000-0000-7000-8000-00000000b201';
const FLAG_A = '01900000-0000-7000-8000-00000000a203';
const FLAG_B = '01900000-0000-7000-8000-00000000b203';
const FLAG_C = '01900000-0000-7000-8000-00000000c203';

const INSERT_FLAG_SQL = `INSERT INTO feature_flags (id, "organizationId", key, enabled, "rolloutPercentage", "updatedAt")
  VALUES ($1, $2, $3, true, 100, NOW())`;

async function seedTenants(admin: Client): Promise<void> {
  await admin.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'A', 'flags-org-a'), ($2, 'B', 'flags-org-b')`,
    [ORG_A, ORG_B],
  );
  await admin.query(INSERT_FLAG_SQL, [FLAG_A, ORG_A, 'checkout.a']);
  await admin.query(INSERT_FLAG_SQL, [FLAG_B, ORG_B, 'checkout.b']);
}

async function flagKeys(admin: Client): Promise<string[]> {
  const { rows } = await admin.query<{ key: string }>('SELECT key FROM feature_flags ORDER BY key');
  return rows.map((row) => row.key);
}

function flagFor(id: string, organizationId: string, key: string): FeatureFlag {
  return FeatureFlag.create({ id, organizationId, key, enabled: true, rolloutPercentage: 100 });
}

describe('feature_flags tenant isolation (integration)', () => {
  let containers: TestContainers;
  let admin: Client;
  let tenant: Client;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    deployTestMigrations(dbUrl);

    admin = new Client({ connectionString: dbUrl });
    await admin.connect();

    const url = await provisionRlsRole(dbUrl);
    tenant = new Client({ connectionString: url });
    await tenant.connect();
  }, 120_000);

  afterAll(async () => {
    await tenant?.end();
    await admin?.end();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await admin.query('TRUNCATE feature_flags, organizations RESTART IDENTITY CASCADE');
    await seedTenants(admin);
  });

  it('is not superuser, so row-level security actually applies', async () => {
    const { rows } = await tenant.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('returns nothing when no organization context is set', async () => {
    const { rows } = await tenant.query('SELECT id FROM feature_flags');
    expect(rows).toHaveLength(0);
  });

  it('rejects an insert when no organization context is set', async () => {
    await expect(tenant.query(INSERT_FLAG_SQL, [FLAG_C, ORG_A, 'checkout.c'])).rejects.toThrow(
      /row-level security/i,
    );
  });

  it('returns only the rows of the organization in context', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const { rows } = await tenant.query('SELECT key FROM feature_flags');
    await tenant.query('COMMIT');

    expect(rows).toEqual([{ key: 'checkout.a' }]);
  });

  it('cannot read another organization by guessing its id', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const { rows } = await tenant.query(
      'SELECT key FROM feature_flags WHERE "organizationId" = $1',
      [ORG_B],
    );
    await tenant.query('COMMIT');

    expect(rows).toHaveLength(0);
  });

  it('writes a row into the organization in context', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    await tenant.query(INSERT_FLAG_SQL, [FLAG_C, ORG_A, 'checkout.c']);
    await tenant.query('COMMIT');

    expect(await flagKeys(admin)).toContain('checkout.c');
  });

  it('cannot write a row into another organization', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);

    await expect(tenant.query(INSERT_FLAG_SQL, [FLAG_C, ORG_B, 'checkout.c'])).rejects.toThrow(
      /row-level security/i,
    );

    await tenant.query('ROLLBACK');
  });

  it('cannot update another organization row', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const result = await tenant.query('UPDATE feature_flags SET enabled = false WHERE id = $1', [
      FLAG_B,
    ]);
    await tenant.query('COMMIT');

    expect(result.rowCount).toBe(0);
    const { rows } = await admin.query('SELECT enabled FROM feature_flags WHERE id = $1', [FLAG_B]);
    expect(rows[0].enabled).toBe(true);
  });

  it('cannot move an owned row into another organization', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);

    await expect(
      tenant.query('UPDATE feature_flags SET "organizationId" = $1 WHERE id = $2', [ORG_B, FLAG_A]),
    ).rejects.toThrow(/row-level security/i);

    await tenant.query('ROLLBACK');
  });

  it('cannot delete another organization row', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const result = await tenant.query('DELETE FROM feature_flags WHERE id = $1', [FLAG_B]);
    await tenant.query('COMMIT');

    expect(result.rowCount).toBe(0);
    expect(await flagKeys(admin)).toEqual(['checkout.a', 'checkout.b']);
  });

  it('drops the context at transaction end so a leaked connection sees nothing', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    await tenant.query('COMMIT');

    const { rows } = await tenant.query('SELECT id FROM feature_flags');
    expect(rows).toHaveLength(0);
  });

  it('still cascades an organization delete issued without a tenant context', async () => {
    await tenant.query('DELETE FROM organizations WHERE id = $1', [ORG_B]);

    expect(await flagKeys(admin)).toEqual(['checkout.a']);
  });

  describe('PrismaFeatureFlagRepository under the RLS role', () => {
    let cls: ClsService<RequestContextStore>;
    let prisma: PrismaService;
    let repository: PrismaFeatureFlagRepository;
    let previousDatabaseUrl: string | undefined;

    beforeAll(async () => {
      previousDatabaseUrl = process.env['DATABASE_URL'];
      process.env['DATABASE_URL'] = await provisionRlsRole(containers.postgres.getConnectionUri());

      cls = new ClsService<RequestContextStore>(new AsyncLocalStorage());
      prisma = new PrismaService(cls);
      await prisma.onModuleInit();
      repository = new PrismaFeatureFlagRepository(prisma);
    }, 60_000);

    afterAll(async () => {
      await prisma?.onApplicationShutdown();
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = previousDatabaseUrl;
    });

    const asOrganization = <R>(organizationId: string, fn: () => Promise<R>): Promise<R> =>
      cls.run(() => {
        cls.set(REQUEST_CONTEXT_KEYS.organizationId, organizationId);
        return fn();
      });

    it('reads its own organization rows through the repository', async () => {
      const all = await asOrganization(ORG_A, () => repository.findAll(ORG_A));
      const page = await asOrganization(ORG_A, () =>
        repository.findAllCursor({ organizationId: ORG_A, limit: 10 }),
      );
      const found = await asOrganization(ORG_A, () => repository.findById(ORG_A, FLAG_A));

      expect(all.map((flag) => flag.key)).toEqual(['checkout.a']);
      expect(page.items.map((flag) => flag.key)).toEqual(['checkout.a']);
      expect(found?.key).toBe('checkout.a');
    });

    it('cannot read another organization row even when the predicate names it', async () => {
      const all = await asOrganization(ORG_A, () => repository.findAll(ORG_B));
      const found = await asOrganization(ORG_A, () => repository.findById(ORG_B, FLAG_B));

      expect(all).toHaveLength(0);
      expect(found).toBeNull();
    });

    it('updates its own organization row', async () => {
      const outcome = await asOrganization(ORG_A, async () => {
        const current = await repository.findById(ORG_A, FLAG_A);
        if (!current) throw new Error('seeded flag is missing');
        return repository.update(current.withChanges({ enabled: false }));
      });

      expect(outcome).toBe('updated');
      const { rows } = await admin.query('SELECT enabled FROM feature_flags WHERE id = $1', [
        FLAG_A,
      ]);
      expect(rows[0].enabled).toBe(false);
    });

    it('reports another organization row as not found on update and delete', async () => {
      const foreign = FeatureFlag.reconstitute({
        id: FLAG_B,
        organizationId: ORG_B,
        key: 'checkout.b',
        description: null,
        enabled: false,
        rolloutPercentage: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 0,
      });

      const outcome = await asOrganization(ORG_A, () => repository.update(foreign));
      const deleted = await asOrganization(ORG_A, () => repository.delete(ORG_B, FLAG_B));

      expect(outcome).toBe('not_found');
      expect(deleted).toBe(false);
      const { rows } = await admin.query('SELECT enabled FROM feature_flags WHERE id = $1', [
        FLAG_B,
      ]);
      expect(rows[0].enabled).toBe(true);
    });

    it('deletes its own organization row', async () => {
      const deleted = await asOrganization(ORG_A, () => repository.delete(ORG_A, FLAG_A));

      expect(deleted).toBe(true);
      expect(await flagKeys(admin)).toEqual(['checkout.b']);
    });

    it('creates a row in its own organization', async () => {
      await asOrganization(ORG_A, () => repository.create(flagFor(FLAG_C, ORG_A, 'checkout.c')));

      expect(await flagKeys(admin)).toContain('checkout.c');
    });

    it('refuses to create a row in another organization', async () => {
      await expect(
        asOrganization(ORG_A, () => repository.create(flagFor(FLAG_C, ORG_B, 'checkout.c'))),
      ).rejects.toThrow();

      expect(await flagKeys(admin)).not.toContain('checkout.c');
    });

    it('sees no rows and cannot insert when no organization is in context', async () => {
      const all = await repository.findAll(ORG_A);

      expect(all).toHaveLength(0);
      await expect(repository.create(flagFor(FLAG_C, ORG_A, 'checkout.c'))).rejects.toThrow();
      expect(await flagKeys(admin)).not.toContain('checkout.c');
    });
  });
});
