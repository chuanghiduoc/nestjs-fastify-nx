import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { FastifyRequest } from 'fastify';
import { Prisma, type PrismaService } from '@nestjs-fastify-nx/infra-database';
import { RolesGuard, type AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { REQUIRED_PERMISSIONS_KEY } from '@nestjs-fastify-nx/infra-authorization';
import { generateId } from '@nestjs-fastify-nx/shared';
import { Term, TERM_TYPE } from './domain/entities/term.entity';
import { PrismaTermRepository } from './infrastructure/repositories/prisma-term.repository';
import { TermsController } from './presentation/controllers/terms.controller';
import { CreateTermDto } from './presentation/dto/term.dto';

const USER_ID = '019dd1a5-9235-70db-8d57-54ef92000001';

const SESSION: AuthenticatedSession = {
  userId: USER_ID,
  email: 'member@example.com',
  name: 'Member',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's-1',
  sessionToken: 't-1',
  organizationId: '019dd1a5-9235-70db-8d57-54ef92000002',
};

function prismaDouble(models: Record<string, Record<string, unknown>>): PrismaService {
  return {
    db: models,
    readTarget: () => models,
    writeTarget: () => models,
  } as unknown as PrismaService;
}

function termRow(overrides: Record<string, unknown> = {}) {
  return {
    id: generateId(),
    type: TERM_TYPE.TERMS_OF_SERVICE,
    version: 'v1',
    content: 'body',
    publishedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaTermRepository', () => {
  it('reads only published rows for the public listing', async () => {
    const findMany = vi.fn().mockResolvedValue([termRow()]);
    const repository = new PrismaTermRepository(prismaDouble({ term: { findMany } }));

    await repository.findPublished();

    expect(findMany.mock.calls[0][0].where).toEqual({ publishedAt: { not: null } });
  });

  it('returns the newest published version of a type', async () => {
    const findFirst = vi.fn().mockResolvedValue(termRow({ version: 'newest' }));
    const repository = new PrismaTermRepository(prismaDouble({ term: { findFirst } }));

    const term = await repository.findLatestPublished(TERM_TYPE.TERMS_OF_SERVICE);

    expect(term?.version).toBe('newest');
    expect(findFirst.mock.calls[0][0].orderBy).toEqual({ publishedAt: 'desc' });
  });

  it('returns null when nothing of that type is published', async () => {
    const repository = new PrismaTermRepository(
      prismaDouble({ term: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );

    expect(await repository.findLatestPublished(TERM_TYPE.COOKIE_POLICY)).toBeNull();
  });

  it('translates a duplicate version into a domain conflict', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '7.0.0',
      meta: {},
    });
    const repository = new PrismaTermRepository(
      prismaDouble({ term: { create: vi.fn().mockRejectedValue(duplicate) } }),
    );

    await expect(
      repository.create(
        Term.create({ type: TERM_TYPE.TERMS_OF_SERVICE, version: 'v1', content: 'body' }),
      ),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('propagates an unrecognised failure', async () => {
    const failure = new Error('connection lost');
    const repository = new PrismaTermRepository(
      prismaDouble({ term: { create: vi.fn().mockRejectedValue(failure) } }),
    );

    await expect(
      repository.create(
        Term.create({ type: TERM_TYPE.TERMS_OF_SERVICE, version: 'v1', content: 'body' }),
      ),
    ).rejects.toBe(failure);
  });

  // Publication date is a legal fact: the compare-and-set is what stops a second publish moving it.
  it('publishes only a row that is still unpublished', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaTermRepository(prismaDouble({ term: { updateMany } }));
    const id = generateId();

    expect(await repository.publish(id, new Date())).toBe(false);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id, publishedAt: null });
  });

  it('records an acceptance as an upsert that never rewrites the timestamp', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const repository = new PrismaTermRepository(prismaDouble({ termAcceptance: { upsert } }));
    const termId = generateId();

    await repository.recordAcceptance({
      termId,
      userId: USER_ID,
      acceptedAt: new Date(),
      ipAddress: null,
    });

    expect(upsert.mock.calls[0][0].where).toEqual({ termId_userId: { termId, userId: USER_ID } });
    expect(upsert.mock.calls[0][0].update).toEqual({});
  });

  it('projects the term type and version onto each acceptance', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        termId: generateId(),
        userId: USER_ID,
        acceptedAt: new Date('2026-08-02T00:00:00.000Z'),
        term: { type: TERM_TYPE.PRIVACY_POLICY, version: 'v2' },
      },
    ]);
    const repository = new PrismaTermRepository(prismaDouble({ termAcceptance: { findMany } }));

    const acceptances = await repository.findAcceptances(USER_ID);

    expect(acceptances[0]).toMatchObject({ type: TERM_TYPE.PRIVACY_POLICY, version: 'v2' });
  });
});

describe('TermsController platform gating', () => {
  function contextFor(
    handler: (...args: never[]) => unknown,
    user: AuthenticatedSession,
  ): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => TermsController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  const guard = new RolesGuard(new Reflector());
  const platformAdmin: AuthenticatedSession = { ...SESSION, role: 'ADMIN' };

  it.each([
    ['create', TermsController.prototype.create],
    ['publish', TermsController.prototype.publish],
  ])('refuses %s to a tenant owner without the platform ADMIN role', (_name, handler) => {
    expect(() => guard.canActivate(contextFor(handler, SESSION))).toThrow(ForbiddenException);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toBeUndefined();
  });

  it.each([
    ['create', TermsController.prototype.create],
    ['publish', TermsController.prototype.publish],
  ])('admits %s to a platform ADMIN', (_name, handler) => {
    expect(guard.canActivate(contextFor(handler, platformAdmin))).toBe(true);
  });

  it('keeps the read and accept routes on the organization axis', () => {
    for (const handler of [
      TermsController.prototype.list,
      TermsController.prototype.acceptances,
      TermsController.prototype.latest,
      TermsController.prototype.accept,
    ]) {
      expect(guard.canActivate(contextFor(handler, SESSION))).toBe(true);
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toBeDefined();
    }
  });
});

describe('TermsController', () => {
  function build() {
    const queryBus = { execute: vi.fn() };
    const commandBus = { execute: vi.fn() };
    return {
      queryBus,
      commandBus,
      controller: new TermsController(
        queryBus as unknown as QueryBus,
        commandBus as unknown as CommandBus,
      ),
    };
  }

  it('returns published terms in a flat list envelope', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [{ id: generateId() }] });

    const response = await controller.list();

    expect(response.object).toBe('list');
    expect(response.url).toBe('/api/v1/terms');
  });

  it('lists the acceptances of the calling user', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [] });

    const response = await controller.acceptances(SESSION);

    expect(response.url).toBe('/api/v1/terms/acceptances');
    expect(queryBus.execute).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
  });

  it('reads the latest version of a type', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ version: 'v1' });

    await controller.latest(TERM_TYPE.PRIVACY_POLICY);

    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: TERM_TYPE.PRIVACY_POLICY }),
    );
  });

  it('dispatches create, publish and accept commands', async () => {
    const { commandBus, controller } = build();
    commandBus.execute.mockResolvedValue({});
    const id = generateId();

    await controller.create(
      Object.assign(new CreateTermDto(), {
        type: TERM_TYPE.TERMS_OF_SERVICE,
        version: 'v1',
        content: 'body',
        publish: true,
      }),
    );
    await controller.publish(id);
    await controller.accept(SESSION, id, { ip: '203.0.113.4' } as FastifyRequest);

    expect(commandBus.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ version: 'v1', publish: true }),
    );
    expect(commandBus.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ id }));
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ userId: USER_ID, termId: id, ipAddress: '203.0.113.4' }),
    );
  });
});
