import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { isDomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { Term, TERM_TYPE } from './term.entity';
import { PrismaTermRepository } from './prisma-term.repository';

const USER_ID = '019dd1a5-9235-70db-8d57-540300000001';

describe('PrismaTermRepository (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let repository: PrismaTermRepository;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();
    repository = new PrismaTermRepository(prisma);
    cleaner = new DatabaseCleaner(prisma.db);
  }, 90_000);

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    await prisma.db.user.create({
      data: { id: USER_ID, email: 'terms@test.com', name: 'Terms', updatedAt: new Date() },
    });
  });

  it('publishes exactly once per version (compare-and-set)', async () => {
    const term = Term.create({
      id: '019dd1a5-9235-70db-8d57-54030000000a',
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
    });
    await repository.create(term);

    expect(await repository.publish(term.id, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
    expect(await repository.publish(term.id, new Date('2026-02-01T00:00:00.000Z'))).toBe(false);

    const stored = await repository.findById(term.id);
    expect(stored?.publishedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('resolves the latest published version deterministically on the id tiebreaker', async () => {
    const publishedAt = new Date('2026-04-01T00:00:00.000Z');
    const older = Term.create({
      id: '019dd1a5-9235-70db-8d57-54030000000b',
      type: TERM_TYPE.COOKIE_POLICY,
      version: 'v1',
      content: 'a',
    });
    const newer = Term.create({
      id: '019dd1a5-9235-70db-8d57-54030000000c',
      type: TERM_TYPE.COOKIE_POLICY,
      version: 'v2',
      content: 'b',
    });
    await repository.create(older);
    await repository.create(newer);
    await repository.publish(older.id, publishedAt);
    await repository.publish(newer.id, publishedAt);

    const latest = await repository.findLatestPublished(TERM_TYPE.COOKIE_POLICY);

    expect(latest?.version).toBe('v2');
  });

  it('keeps the first acceptance timestamp on a repeated acceptance', async () => {
    const term = Term.create({
      id: '019dd1a5-9235-70db-8d57-54030000000d',
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
    });
    await repository.create(term);
    const first = new Date('2026-05-01T00:00:00.000Z');

    await repository.recordAcceptance({
      termId: term.id,
      userId: USER_ID,
      acceptedAt: first,
      ipAddress: '203.0.113.9',
    });
    await repository.recordAcceptance({
      termId: term.id,
      userId: USER_ID,
      acceptedAt: new Date('2026-06-01T00:00:00.000Z'),
      ipAddress: '203.0.113.10',
    });

    const acceptances = await repository.findAcceptances(USER_ID);
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0].acceptedAt.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('lists only published terms', async () => {
    const published = Term.create({
      id: '019dd1a5-9235-70db-8d57-54030000000e',
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'a',
    });
    const draft = Term.create({
      id: '019dd1a5-9235-70db-8d57-54030000000f',
      type: TERM_TYPE.COOKIE_POLICY,
      version: 'v1',
      content: 'b',
    });
    await repository.create(published);
    await repository.create(draft);
    await repository.publish(published.id, new Date());

    const result = await repository.findPublished();

    expect(result.map((term) => term.id)).toEqual([published.id]);
  });

  it('survives the account being deleted (SetNull keeps the acceptance)', async () => {
    const term = Term.create({
      id: '019dd1a5-9235-70db-8d57-540300000010',
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
    });
    await repository.create(term);
    await repository.recordAcceptance({
      termId: term.id,
      userId: USER_ID,
      acceptedAt: new Date(),
      ipAddress: null,
    });

    await prisma.db.user.delete({ where: { id: USER_ID } });

    const row = await prisma.db.termAcceptance.findFirstOrThrow({ where: { termId: term.id } });
    expect(row.userId).toBeNull();
  });

  it('maps a duplicate type+version to TERM_VERSION_TAKEN', async () => {
    const term = Term.create({
      id: '019dd1a5-9235-70db-8d57-540300000011',
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'body',
    });
    await repository.create(term);
    const duplicate = Term.create({
      id: '019dd1a5-9235-70db-8d57-540300000012',
      type: TERM_TYPE.TERMS_OF_SERVICE,
      version: 'v1',
      content: 'other body',
    });

    try {
      await repository.create(duplicate);
      expect.unreachable('expected a duplicate type+version to be rejected');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.kind).toBe('conflict');
        expect(err.code).toBe(ERROR_CODES.TERM_VERSION_TAKEN);
      }
    }
  });
}, 90_000);
