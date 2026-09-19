import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
  type TestContainers,
} from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { DOMAIN_EVENTS, SYSTEM_ROLES } from '@nestjs-fastify-nx/shared';
import { EnsurePersonalOrganizationCommand } from '../../application/commands/ensure-personal-organization/ensure-personal-organization.command';
import { EnsurePersonalOrganizationHandler } from '../../application/commands/ensure-personal-organization/ensure-personal-organization.handler';
import { PrismaPersonalOrganizationRepository } from './prisma-personal-organization.repository';

describe('personal organization provisioning (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let cleaner: DatabaseCleaner;
  let handler: EnsurePersonalOrganizationHandler;
  let userId: string;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);
    prisma = new PrismaService();
    await prisma.onModuleInit();
    cleaner = new DatabaseCleaner(prisma.db);
    handler = new EnsurePersonalOrganizationHandler(
      new PrismaPersonalOrganizationRepository(prisma),
    );
  }, 90_000);

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    const user = await prisma.db.user.create({
      data: { name: '  Workspace Owner  ', email: 'owner@provisioning.local' },
    });
    userId = user.id;
  });

  it('creates an owner membership and exactly one event for each new resource', async () => {
    const id = await handler.execute(new EnsurePersonalOrganizationCommand(userId));
    const organization = await prisma.db.organization.findUniqueOrThrow({ where: { id } });
    expect(organization.name).toBe('Workspace Owner');
    expect(organization.slug).toMatch(/^ws-[a-f0-9]{32}$/);
    expect(organization.slug).not.toContain(userId.replace(/-/g, ''));
    expect(await prisma.db.member.findMany({ where: { userId } })).toEqual([
      expect.objectContaining({ organizationId: id, role: SYSTEM_ROLES.OWNER }),
    ]);
    const events = await prisma.db.outboxEvent.findMany({ where: { organizationId: id } });
    expect(events.map((event) => event.eventType).sort()).toEqual(
      [DOMAIN_EVENTS.ORGANIZATIONS_CREATED, DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ADDED].sort(),
    );
  });

  it('uses the email local part when the display name is blank', async () => {
    await prisma.db.user.update({ where: { id: userId }, data: { name: '  ' } });
    const id = await handler.execute(new EnsurePersonalOrganizationCommand(userId));
    expect(await prisma.db.organization.findUnique({ where: { id } })).toMatchObject({
      name: 'owner',
    });
  });

  it('reuses the earliest membership even when the user is not its owner', async () => {
    const first = await prisma.db.organization.create({ data: { name: 'First', slug: 'first' } });
    const second = await prisma.db.organization.create({
      data: { name: 'Second', slug: 'second' },
    });
    await prisma.db.member.createMany({
      data: [
        {
          userId,
          organizationId: first.id,
          role: SYSTEM_ROLES.MEMBER,
          createdAt: new Date('2026-01-01'),
        },
        {
          userId,
          organizationId: second.id,
          role: SYSTEM_ROLES.OWNER,
          createdAt: new Date('2026-02-01'),
        },
      ],
    });
    expect(await handler.execute(new EnsurePersonalOrganizationCommand(userId))).toBe(first.id);
    expect(await prisma.db.organization.count()).toBe(2);
  });

  it('serializes simultaneous first sessions without duplicate organizations or events', async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, () =>
        handler.execute(new EnsurePersonalOrganizationCommand(userId)),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.db.organization.count()).toBe(1);
    expect(await prisma.db.member.count({ where: { userId } })).toBe(1);
    expect(await prisma.db.outboxEvent.count({ where: { organizationId: ids[0] } })).toBe(2);
  });

  it('rolls back membership, organization and their events with the enclosing transaction', async () => {
    await expect(
      prisma.transaction(async () => {
        await handler.execute(new EnsurePersonalOrganizationCommand(userId));
        throw new Error('abort provisioning');
      }),
    ).rejects.toThrow('abort provisioning');
    expect(await prisma.db.organization.count()).toBe(0);
    expect(await prisma.db.member.count({ where: { userId } })).toBe(0);
    expect(
      await prisma.db.outboxEvent.count({
        where: {
          eventType: {
            in: [DOMAIN_EVENTS.ORGANIZATIONS_CREATED, DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ADDED],
          },
        },
      }),
    ).toBe(0);
  });
});
