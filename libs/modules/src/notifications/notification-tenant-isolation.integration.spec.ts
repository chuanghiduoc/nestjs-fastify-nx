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
import { Notification } from './notification.entity';
import { PrismaNotificationRepository } from './prisma-notification.repository';

const ORG_A = '01900000-0000-7000-8000-00000000a101';
const ORG_B = '01900000-0000-7000-8000-00000000b101';
const USER_A = '01900000-0000-7000-8000-00000000a102';
const USER_B = '01900000-0000-7000-8000-00000000b102';
const NOTIFICATION_A = '01900000-0000-7000-8000-00000000a103';
const NOTIFICATION_B = '01900000-0000-7000-8000-00000000b103';
const NOTIFICATION_C = '01900000-0000-7000-8000-00000000c103';

const INSERT_NOTIFICATION_SQL = `INSERT INTO notifications (id, "organizationId", "userId", type, title, body)
  VALUES ($1, $2, $3, 'organization.member_added', 'Welcome', 'Body')`;

async function seedTenants(admin: Client): Promise<void> {
  await admin.query(
    `INSERT INTO users (id, name, email, "updatedAt") VALUES
       ($1, 'A', 'notify-a@test.local', NOW()),
       ($2, 'B', 'notify-b@test.local', NOW())`,
    [USER_A, USER_B],
  );
  await admin.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'A', 'notify-org-a'), ($2, 'B', 'notify-org-b')`,
    [ORG_A, ORG_B],
  );
  await admin.query(INSERT_NOTIFICATION_SQL, [NOTIFICATION_A, ORG_A, USER_A]);
  await admin.query(INSERT_NOTIFICATION_SQL, [NOTIFICATION_B, ORG_B, USER_B]);
}

async function notificationIds(admin: Client): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>('SELECT id FROM notifications ORDER BY id');
  return rows.map((row) => row.id);
}

function notificationFor(id: string, organizationId: string, userId: string): Notification {
  return Notification.create({
    id,
    organizationId,
    userId,
    type: 'organization.member_added',
    title: 'Welcome',
    body: 'Body',
  });
}

describe('notifications tenant isolation (integration)', () => {
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
    await admin.query('TRUNCATE notifications, organizations, users RESTART IDENTITY CASCADE');
    await seedTenants(admin);
  });

  it('is not superuser, so row-level security actually applies', async () => {
    const { rows } = await tenant.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('returns nothing when no organization context is set', async () => {
    const { rows } = await tenant.query('SELECT id FROM notifications');
    expect(rows).toHaveLength(0);
  });

  it('rejects an insert when no organization context is set', async () => {
    await expect(
      tenant.query(INSERT_NOTIFICATION_SQL, [NOTIFICATION_C, ORG_A, USER_A]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('returns only the rows of the organization in context', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const { rows } = await tenant.query('SELECT id FROM notifications');
    await tenant.query('COMMIT');

    expect(rows).toEqual([{ id: NOTIFICATION_A }]);
  });

  it('cannot read another organization by guessing its id', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const { rows } = await tenant.query(
      'SELECT id FROM notifications WHERE "organizationId" = $1',
      [ORG_B],
    );
    await tenant.query('COMMIT');

    expect(rows).toHaveLength(0);
  });

  it('writes a row into the organization in context', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    await tenant.query(INSERT_NOTIFICATION_SQL, [NOTIFICATION_C, ORG_A, USER_A]);
    await tenant.query('COMMIT');

    expect(await notificationIds(admin)).toContain(NOTIFICATION_C);
  });

  it('cannot write a row into another organization', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);

    await expect(
      tenant.query(INSERT_NOTIFICATION_SQL, [NOTIFICATION_C, ORG_B, USER_A]),
    ).rejects.toThrow(/row-level security/i);

    await tenant.query('ROLLBACK');
  });

  it('cannot update another organization row', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const result = await tenant.query('UPDATE notifications SET "readAt" = NOW() WHERE id = $1', [
      NOTIFICATION_B,
    ]);
    await tenant.query('COMMIT');

    expect(result.rowCount).toBe(0);
    const { rows } = await admin.query('SELECT "readAt" FROM notifications WHERE id = $1', [
      NOTIFICATION_B,
    ]);
    expect(rows[0].readAt).toBeNull();
  });

  it('cannot move an owned row into another organization', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);

    await expect(
      tenant.query('UPDATE notifications SET "organizationId" = $1 WHERE id = $2', [
        ORG_B,
        NOTIFICATION_A,
      ]),
    ).rejects.toThrow(/row-level security/i);

    await tenant.query('ROLLBACK');
  });

  it('cannot delete another organization row', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    const result = await tenant.query('DELETE FROM notifications WHERE id = $1', [NOTIFICATION_B]);
    await tenant.query('COMMIT');

    expect(result.rowCount).toBe(0);
    expect(await notificationIds(admin)).toEqual([NOTIFICATION_A, NOTIFICATION_B]);
  });

  it('drops the context at transaction end so a leaked connection sees nothing', async () => {
    await tenant.query('BEGIN');
    await tenant.query(`SELECT set_config('app.current_org_id', $1, true)`, [ORG_A]);
    await tenant.query('COMMIT');

    const { rows } = await tenant.query('SELECT id FROM notifications');
    expect(rows).toHaveLength(0);
  });

  it('still cascades an organization delete issued without a tenant context', async () => {
    await tenant.query('DELETE FROM organizations WHERE id = $1', [ORG_B]);

    expect(await notificationIds(admin)).toEqual([NOTIFICATION_A]);
  });

  describe('PrismaNotificationRepository under the RLS role', () => {
    let cls: ClsService<RequestContextStore>;
    let prisma: PrismaService;
    let repository: PrismaNotificationRepository;
    let previousDatabaseUrl: string | undefined;

    beforeAll(async () => {
      previousDatabaseUrl = process.env['DATABASE_URL'];
      process.env['DATABASE_URL'] = await provisionRlsRole(containers.postgres.getConnectionUri());

      cls = new ClsService<RequestContextStore>(new AsyncLocalStorage());
      prisma = new PrismaService(cls);
      await prisma.onModuleInit();
      repository = new PrismaNotificationRepository(prisma);
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

    it('lists and counts its own organization rows through the repository', async () => {
      const page = await asOrganization(ORG_A, () =>
        repository.findAllCursor({
          organizationId: ORG_A,
          userId: USER_A,
          limit: 10,
          unreadOnly: false,
        }),
      );
      const unread = await asOrganization(ORG_A, () => repository.countUnread(ORG_A, USER_A));

      expect(page.items.map((item) => item.id)).toEqual([NOTIFICATION_A]);
      expect(unread).toBe(1);
    });

    it('cannot read another organization row even when the predicate names it', async () => {
      const page = await asOrganization(ORG_A, () =>
        repository.findAllCursor({
          organizationId: ORG_B,
          userId: USER_B,
          limit: 10,
          unreadOnly: false,
        }),
      );
      const found = await asOrganization(ORG_A, () =>
        repository.exists(ORG_B, USER_B, NOTIFICATION_B),
      );

      expect(page.items).toHaveLength(0);
      expect(found).toBe(false);
    });

    it('cannot mark another organization row read', async () => {
      const changed = await asOrganization(ORG_A, () =>
        repository.markRead(ORG_B, USER_B, NOTIFICATION_B, new Date()),
      );
      const marked = await asOrganization(ORG_A, () =>
        repository.markAllRead(ORG_B, USER_B, new Date()),
      );

      expect(changed).toBe(false);
      expect(marked).toBe(0);
      const { rows } = await admin.query('SELECT "readAt" FROM notifications WHERE id = $1', [
        NOTIFICATION_B,
      ]);
      expect(rows[0].readAt).toBeNull();
    });

    it('creates a row in its own organization', async () => {
      await asOrganization(ORG_A, () =>
        repository.create(notificationFor(NOTIFICATION_C, ORG_A, USER_A)),
      );

      expect(await notificationIds(admin)).toContain(NOTIFICATION_C);
    });

    it('refuses to create a row in another organization', async () => {
      await expect(
        asOrganization(ORG_A, () =>
          repository.create(notificationFor(NOTIFICATION_C, ORG_B, USER_B)),
        ),
      ).rejects.toThrow();

      expect(await notificationIds(admin)).not.toContain(NOTIFICATION_C);
    });

    it('sees no rows and cannot insert when no organization is in context', async () => {
      const page = await repository.findAllCursor({
        organizationId: ORG_A,
        userId: USER_A,
        limit: 10,
        unreadOnly: false,
      });

      expect(page.items).toHaveLength(0);
      await expect(
        repository.create(notificationFor(NOTIFICATION_C, ORG_A, USER_A)),
      ).rejects.toThrow();
      expect(await notificationIds(admin)).not.toContain(NOTIFICATION_C);
    });
  });
});
