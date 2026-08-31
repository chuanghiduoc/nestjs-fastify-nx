import { describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { generateId } from '@nestjs-fastify-nx/shared';
import { PrismaSessionRepository } from './infrastructure/repositories/prisma-session.repository';
import { SessionsController } from './presentation/controllers/sessions.controller';
import { ListSessionsFilterDto } from './presentation/dto/session.dto';

const USER_ID = '019dd1a5-9235-70db-8d57-54ef92100001';
const SESSION_ID = '019dd1a5-9235-70db-8d57-54ef92100002';

const SESSION: AuthenticatedSession = {
  userId: USER_ID,
  email: 'member@example.com',
  name: 'Member',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: SESSION_ID,
  sessionToken: 't-1',
  organizationId: '019dd1a5-9235-70db-8d57-54ef92100003',
};

function prismaDouble(methods: Record<string, unknown>): PrismaService {
  const db = { session: methods };
  return { db, readTarget: () => db, writeTarget: () => db } as unknown as PrismaService;
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: generateId(),
    userId: USER_ID,
    ipAddress: '203.0.113.9',
    userAgent: 'curl/8',
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaSessionRepository', () => {
  // The token is the bearer credential: a listing that selected it would let one response hand
  // over every device.
  it('never selects the session token', async () => {
    const findMany = vi.fn().mockResolvedValue([sessionRow()]);
    const repository = new PrismaSessionRepository(prismaDouble({ findMany }));

    await repository.findAllCursor({
      userId: USER_ID,
      limit: 10,
      activeOnly: true,
      now: new Date(),
    });

    expect(findMany.mock.calls[0][0].select.token).toBeUndefined();
  });

  it('hides expired sessions when activeOnly is set', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaSessionRepository(prismaDouble({ findMany }));
    const now = new Date('2026-08-01T00:00:00.000Z');

    await repository.findAllCursor({ userId: USER_ID, limit: 10, activeOnly: true, now });

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      userId: USER_ID,
      expiresAt: { gt: now },
    });
  });

  it('keeps expired sessions when activeOnly is off', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaSessionRepository(prismaDouble({ findMany }));

    await repository.findAllCursor({
      userId: USER_ID,
      limit: 10,
      activeOnly: false,
      now: new Date(),
    });

    expect(findMany.mock.calls[0][0].where.expiresAt).toBeUndefined();
  });

  it('adds a keyset predicate for a cursor and reports hasMore', async () => {
    const findMany = vi.fn().mockResolvedValue([sessionRow(), sessionRow(), sessionRow()]);
    const repository = new PrismaSessionRepository(prismaDouble({ findMany }));
    const createdAt = new Date('2026-08-01T00:00:00.000Z');

    const result = await repository.findAllCursor({
      userId: USER_ID,
      limit: 2,
      activeOnly: true,
      now: new Date(),
      startingAfter: { createdAt, id: generateId() },
    });

    expect(findMany.mock.calls[0][0].where.AND[0].OR).toHaveLength(2);
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('scopes a single-session lookup to the owner', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaSessionRepository(prismaDouble({ findFirst }));
    const id = generateId();

    expect(await repository.findByIdForUser(USER_ID, id)).toBeNull();
    expect(findFirst.mock.calls[0][0].where).toEqual({ id, userId: USER_ID });
  });

  it('deletes only a session owned by the caller', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaSessionRepository(prismaDouble({ deleteMany }));
    const id = generateId();

    expect(await repository.deleteForUser(USER_ID, id)).toBe(false);
    expect(deleteMany.mock.calls[0][0].where).toEqual({ id, userId: USER_ID });
  });

  it('keeps the current session when revoking the others', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const repository = new PrismaSessionRepository(prismaDouble({ deleteMany }));

    expect(await repository.deleteAllForUserExcept(USER_ID, SESSION_ID)).toBe(2);
    expect(deleteMany.mock.calls[0][0].where).toEqual({
      userId: USER_ID,
      id: { not: SESSION_ID },
    });
  });
});

describe('SessionsController', () => {
  function build() {
    const queryBus = { execute: vi.fn() };
    const commandBus = { execute: vi.fn() };
    return {
      queryBus,
      commandBus,
      controller: new SessionsController(
        queryBus as unknown as QueryBus,
        commandBus as unknown as CommandBus,
      ),
    };
  }

  it('passes the caller and their current session into the query', async () => {
    const { queryBus, controller } = build();
    queryBus.execute.mockResolvedValue({ data: [], hasMore: false, lastCursor: null });

    const response = await controller.list(SESSION, new ListSessionsFilterDto());

    expect(response.url).toBe('/api/v1/sessions');
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, currentSessionId: SESSION_ID }),
    );
  });

  it('dispatches revoke and revoke-others commands', async () => {
    const { commandBus, controller } = build();
    commandBus.execute.mockResolvedValue({ revoked: 1 });
    const id = generateId();

    await controller.revoke(SESSION, id);
    await controller.revokeOthers(SESSION);

    expect(commandBus.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ userId: USER_ID, id }),
    );
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ userId: USER_ID, currentSessionId: SESSION_ID }),
    );
  });
});
