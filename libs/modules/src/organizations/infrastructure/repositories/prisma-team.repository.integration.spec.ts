import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Team } from '../../domain/entities/team.entity';
import { PrismaTeamRepository } from './prisma-team.repository';

const ORG_A = '019dd1a5-9235-70db-8d57-540900000001';
const ORG_B = '019dd1a5-9235-70db-8d57-540900000002';
const USER_A = '019dd1a5-9235-70db-8d57-540900000003';
const USER_B = '019dd1a5-9235-70db-8d57-540900000004';

const CREATED_AT = new Date('2026-08-01T00:00:00.000Z');

describe('PrismaTeamRepository (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let repository: PrismaTeamRepository;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();
    repository = new PrismaTeamRepository(prisma);
    cleaner = new DatabaseCleaner(prisma.db);
  }, 90_000);

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    await prisma.db.organization.createMany({
      data: [
        { id: ORG_A, name: 'Teams Org', slug: 'teams-org' },
        { id: ORG_B, name: 'Other Teams', slug: 'other-teams' },
      ],
    });
    await prisma.db.user.createMany({
      data: [
        { id: USER_A, name: 'Member A', email: 'member-a@teams.local' },
        { id: USER_B, name: 'Member B', email: 'member-b@teams.local' },
      ],
    });
  });

  it('creates a team and scopes findById to its organization', async () => {
    const team = Team.create({ organizationId: ORG_A, name: 'Platform' });
    await repository.create(team);

    expect(await repository.findById(ORG_A, team.id)).toMatchObject({
      name: 'Platform',
      memberCount: 0,
    });
    expect(await repository.findById(ORG_B, team.id)).toBeNull();
  });

  it('translates a duplicate name into a conflict', async () => {
    await repository.create(Team.create({ organizationId: ORG_A, name: 'Platform' }));

    await expect(
      repository.create(Team.create({ organizationId: ORG_A, name: 'Platform' })),
    ).rejects.toMatchObject({ code: 'team_name_taken' });
  });

  it('renames a team in place and refuses another organization', async () => {
    const team = Team.create({ organizationId: ORG_A, name: 'Platform' });
    await repository.create(team);

    expect(await repository.update(team.renamedTo('Core'))).toBe(true);
    expect((await repository.findById(ORG_A, team.id))?.name).toBe('Core');

    const hijack = Team.create({ id: team.id, organizationId: ORG_B, name: 'Hijacked' });
    expect(await repository.update(hijack)).toBe(false);
    expect((await repository.findById(ORG_A, team.id))?.name).toBe('Core');
  });

  it('translates a duplicate name on rename too', async () => {
    const first = Team.create({ organizationId: ORG_A, name: 'Platform' });
    await repository.create(first);
    await repository.create(Team.create({ organizationId: ORG_A, name: 'Core' }));

    await expect(repository.update(first.renamedTo('Core'))).rejects.toMatchObject({
      code: 'team_name_taken',
    });
  });

  it('carries the team member count onto reads', async () => {
    const team = Team.create({ organizationId: ORG_A, name: 'Platform' });
    await repository.create(team);
    await prisma.db.teamMember.createMany({
      data: [
        { teamId: team.id, userId: USER_A },
        { teamId: team.id, userId: USER_B },
      ],
    });

    expect((await repository.findById(ORG_A, team.id))?.memberCount).toBe(2);

    const listed = await repository.findAllCursor({ organizationId: ORG_A, limit: 10 });
    expect(listed.items[0].memberCount).toBe(2);
  });

  it('treats LIKE metacharacters in the search term as literals', async () => {
    await repository.create(Team.create({ organizationId: ORG_A, name: '50%_off' }));
    await repository.create(Team.create({ organizationId: ORG_A, name: '50Xoff' }));
    await repository.create(Team.create({ organizationId: ORG_A, name: 'has_underscore' }));
    await repository.create(Team.create({ organizationId: ORG_A, name: 'hasXunderscore' }));
    await repository.create(Team.create({ organizationId: ORG_B, name: '50%_off' }));

    const percent = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 10,
      search: '50%_off',
    });
    expect(percent.items.map((team) => team.name)).toEqual(['50%_off']);

    const underscore = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 10,
      search: 'has_underscore',
    });
    expect(underscore.items.map((team) => team.name)).toEqual(['has_underscore']);

    const insensitive = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 10,
      search: '50XOFF',
    });
    expect(insensitive.items.map((team) => team.name)).toEqual(['50Xoff']);
  });

  it('paginates a search result with the keyset cursor', async () => {
    const olderId = '019dd1a5-9235-70db-8d57-540900000011';
    const newerLowId = '019dd1a5-9235-70db-8d57-540900000012';
    const newerHighId = '019dd1a5-9235-70db-8d57-540900000013';
    const newerTime = new Date('2026-08-02T00:00:00.000Z');
    await prisma.db.team.createMany({
      data: [
        { id: olderId, organizationId: ORG_A, name: 'Paged One', createdAt: CREATED_AT },
        { id: newerLowId, organizationId: ORG_A, name: 'Paged Two', createdAt: newerTime },
        { id: newerHighId, organizationId: ORG_A, name: 'Paged Three', createdAt: newerTime },
        {
          id: '019dd1a5-9235-70db-8d57-540900000014',
          organizationId: ORG_B,
          name: 'Paged Foreign',
          createdAt: newerTime,
        },
        {
          id: '019dd1a5-9235-70db-8d57-540900000015',
          organizationId: ORG_A,
          name: 'Unrelated',
          createdAt: newerTime,
        },
      ],
    });

    const first = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 2,
      search: 'Paged',
    });
    expect(first.items.map((team) => team.id)).toEqual([newerHighId, newerLowId]);
    expect(first.hasMore).toBe(true);

    const last = first.items[first.items.length - 1];
    const second = await repository.findAllCursor({
      organizationId: ORG_A,
      limit: 2,
      search: 'Paged',
      startingAfter: { createdAt: last.createdAt, id: last.id },
    });
    expect(second.items.map((team) => team.id)).toEqual([olderId]);
    expect(second.hasMore).toBe(false);
  });

  it('scopes deletes to the organization', async () => {
    const team = Team.create({ organizationId: ORG_A, name: 'Platform' });
    await repository.create(team);

    expect(await repository.delete(ORG_B, team.id)).toBe(false);
    expect(await repository.findById(ORG_A, team.id)).not.toBeNull();

    expect(await repository.delete(ORG_A, team.id)).toBe(true);
    expect(await repository.findById(ORG_A, team.id)).toBeNull();
  });
}, 90_000);
