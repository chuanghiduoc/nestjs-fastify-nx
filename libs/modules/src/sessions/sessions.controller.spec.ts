import { describe, expect, it, vi } from 'vitest';
import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { generateId } from '@nestjs-fastify-nx/shared';
import { SessionsController } from './sessions.controller';
import { ListSessionsFilterDto } from './sessions.dto';

const USER_ID = '019dd1a5-9235-70db-8d57-54ef92100001';
const SESSION_ID = '019dd1a5-9235-70db-8d57-54ef92100002';

const SESSION: AuthenticatedSession = {
  userId: USER_ID,
  email: 'member@example.com',
  name: 'Member',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: SESSION_ID,
  organizationId: '019dd1a5-9235-70db-8d57-54ef92100003',
};

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
