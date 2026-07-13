import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();

    process.env['DATABASE_URL'] = dbUrl;

    deployTestMigrations(dbUrl);

    prismaService = new PrismaService();
    await prismaService.onModuleInit();

    repository = new PrismaAuditLogRepository(prismaService);
    cleaner = new DatabaseCleaner(prismaService.db);
  }, 90_000);

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await containers.teardown();
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

  it('append same eventId twice → exactly 1 row (idempotent on outbox redelivery)', async () => {
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
    // Second call must not throw — P2002 is caught and treated as a no-op.
    await expect(repository.append(entry)).resolves.toBeUndefined();

    const rows = await prismaService.db.auditLog.findMany({
      where: { id: deterministicId },
    });
    // Exactly one row — duplicate INSERT was silently dropped.
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
}, 90_000);
