import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ClsService } from 'nestjs-cls';
import { AsyncLocalStorage } from 'node:async_hooks';
import { REQUEST_CONTEXT_KEYS } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { PrismaAuditLogRepository } from './prisma-audit-log.repository';
import { AuditLog } from '../../domain/entities/audit-log.entity';

describe('PrismaAuditLogRepository (integration)', () => {
  let containers: TestContainers;
  let prismaService: PrismaService;
  let repository: PrismaAuditLogRepository;
  let cleaner: DatabaseCleaner;
  let cls: ClsService;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();

    process.env['DATABASE_URL'] = dbUrl;

    deployTestMigrations(dbUrl);

    cls = new ClsService(new AsyncLocalStorage());
    prismaService = new PrismaService(cls);
    await prismaService.onModuleInit();

    repository = new PrismaAuditLogRepository(prismaService);
    cleaner = new DatabaseCleaner(prismaService.db);
  }, 90_000);

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
  });

  it('appends a single audit entry', async () => {
    const entry = AuditLog.create({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      action: 'users.registered',
      userId: 'aaaaaaaa-0000-0000-0000-000000000011',
      resource: 'user',
    });

    await repository.append(entry);

    const rows = await prismaService.db.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(rows[0].action).toBe('users.registered');
  });

  it('appends the same eventId twice as exactly 1 row', async () => {
    // Simulate the outbox relay delivering the same event twice.
    // Both calls use the same deterministic id (derived from event.eventId).
    const deterministicId = 'bbbbbbbb-0000-0000-0000-000000000002';

    const entry = AuditLog.create({
      id: deterministicId,
      action: 'users.logged_in',
      userId: 'bbbbbbbb-0000-0000-0000-000000000022',
      resource: 'user',
    });

    await repository.append(entry);
    // P2002 is caught and treated as a no-op on redelivery.
    await expect(repository.append(entry)).resolves.toBeUndefined();

    const rows = await prismaService.db.auditLog.findMany({
      where: { id: deterministicId },
    });
    // The duplicate INSERT was silently dropped.
    expect(rows).toHaveLength(1);
  });

  it('different eventIds produce separate rows', async () => {
    const first = AuditLog.create({
      id: 'cccccccc-0000-0000-0000-000000000003',
      action: 'users.logged_out',
      userId: 'cccccccc-0000-0000-0000-000000000033',
    });
    const second = AuditLog.create({
      id: 'dddddddd-0000-0000-0000-000000000004',
      action: 'users.logged_out',
      userId: 'cccccccc-0000-0000-0000-000000000033',
    });

    await repository.append(first);
    await repository.append(second);

    const rows = await prismaService.db.auditLog.findMany({
      where: { userId: 'cccccccc-0000-0000-0000-000000000033' },
    });
    expect(rows).toHaveLength(2);
  });

  describe('findAllCursor', () => {
    const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90500001';
    const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef90500002';
    const ACTOR_ID = '019dd1a5-9235-70db-8d57-54ef90500010';
    const BASE_TIME = new Date('2026-08-01T00:00:00.000Z');

    // audit_logs is behind row-level security, and the repository binds the tenant from the
    // request context. Reads therefore have to run inside a CLS scope, exactly as they do in a
    // real request.
    function readAs<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
      return cls.run(() => {
        cls.set(REQUEST_CONTEXT_KEYS.organizationId, organizationId);
        return fn();
      });
    }

    async function seed(
      minutesFromBase: number,
      overrides: Partial<{ organizationId: string; action: string; resource: string }> = {},
    ): Promise<AuditLog> {
      const entry = AuditLog.create({
        id: generateId(),
        organizationId: overrides.organizationId ?? ORG_ID,
        userId: ACTOR_ID,
        action: overrides.action ?? 'users.registered',
        resource: overrides.resource ?? 'user',
        metadata: { source: 'integration' },
        occurredAt: new Date(BASE_TIME.getTime() + minutesFromBase * 60_000),
      });
      await repository.append(entry);
      return entry;
    }

    it('returns entries newest first and scoped to the organization', async () => {
      await seed(0);
      await seed(10);
      await seed(5, { organizationId: OTHER_ORG_ID });

      const result = await readAs(ORG_ID, () =>
        repository.findAllCursor({ organizationId: ORG_ID, limit: 20 }),
      );

      expect(result.items).toHaveLength(2);
      expect(result.items[0].createdAt.getTime()).toBeGreaterThan(
        result.items[1].createdAt.getTime(),
      );
      expect(result.items.every((entry) => entry.organizationId === ORG_ID)).toBe(true);
      expect(result.hasMore).toBe(false);
    });

    it('pages through entries without repeating one', async () => {
      for (let index = 0; index < 5; index += 1) await seed(index);

      const first = await readAs(ORG_ID, () =>
        repository.findAllCursor({ organizationId: ORG_ID, limit: 2 }),
      );
      const last = first.items[first.items.length - 1];
      const second = await readAs(ORG_ID, () =>
        repository.findAllCursor({
          organizationId: ORG_ID,
          limit: 2,
          startingAfter: { createdAt: last.createdAt, id: last.id },
        }),
      );

      expect(first.hasMore).toBe(true);
      expect(second.items).toHaveLength(2);
      const firstIds = first.items.map((entry) => entry.id);
      expect(second.items.some((entry) => firstIds.includes(entry.id))).toBe(false);
    });

    it('filters by action, resource and an inclusive time window', async () => {
      await seed(0, { action: 'users.registered' });
      await seed(10, { action: 'users.logged_in' });
      await seed(20, { action: 'users.logged_in', resource: 'organization' });

      const byAction = await readAs(ORG_ID, () =>
        repository.findAllCursor({ organizationId: ORG_ID, limit: 20, action: 'users.logged_in' }),
      );
      const byResource = await readAs(ORG_ID, () =>
        repository.findAllCursor({ organizationId: ORG_ID, limit: 20, resource: 'organization' }),
      );
      const byWindow = await readAs(ORG_ID, () =>
        repository.findAllCursor({
          organizationId: ORG_ID,
          limit: 20,
          occurredFrom: new Date(BASE_TIME.getTime() + 10 * 60_000),
          occurredUntil: new Date(BASE_TIME.getTime() + 20 * 60_000),
        }),
      );

      expect(byAction.items).toHaveLength(2);
      expect(byResource.items).toHaveLength(1);
      expect(byWindow.items).toHaveLength(2);
    });

    it('reconstitutes metadata as an object even when the column holds a scalar', async () => {
      const id = generateId();
      await prismaService.db.auditLog.create({
        data: {
          id,
          organizationId: ORG_ID,
          userId: ACTOR_ID,
          action: 'users.registered',
          resource: 'user',
          metadata: 'not-an-object',
          createdAt: BASE_TIME,
        },
      });

      const result = await readAs(ORG_ID, () =>
        repository.findAllCursor({ organizationId: ORG_ID, limit: 20 }),
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].metadata).toEqual({});
    });
  });
}, 90_000);
