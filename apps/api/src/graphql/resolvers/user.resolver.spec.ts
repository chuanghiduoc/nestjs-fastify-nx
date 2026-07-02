import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { UserResolver } from './user.resolver';
import { GetUserProfileQuery, ListUsersCursorQuery } from '@nestjs-fastify-nx/modules-users';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';

const mockProfileResult = {
  id: 'u1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockListResult = {
  data: [
    {
      id: 'u1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'USER' as const,
      status: 'ACTIVE' as const,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  ],
  hasMore: false,
  lastCursor: 'dGVzdC1jdXJzb3I',
};

const mockSession: AuthenticatedSession = {
  userId: 'u1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'USER',
  status: 'ACTIVE',
  sessionId: 's1',
  sessionToken: 'tok',
};

describe('UserResolver', () => {
  let resolver: UserResolver;
  let execute: ReturnType<typeof vi.fn>;
  let queryBus: QueryBus;

  beforeEach(() => {
    // Single QueryBus mock dispatches by query type — mirrors how the global bus routes to handlers.
    execute = vi.fn(async (query: unknown) => {
      if (query instanceof GetUserProfileQuery) return mockProfileResult;
      if (query instanceof ListUsersCursorQuery) return mockListResult;
      throw new Error(`unexpected query: ${String(query)}`);
    });
    queryBus = { execute } as unknown as QueryBus;
    resolver = new UserResolver(queryBus);
  });

  describe('me', () => {
    it('returns user profile for authenticated request', async () => {
      const ctx: { req: { user: AuthenticatedSession } } = { req: { user: mockSession } };
      const result = await resolver.me(ctx);
      expect(result?.id).toBe('u1');
      expect(result?.email).toBe('test@example.com');
      expect(result?.name).toBe('Test User');
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    });

    it('returns null when user is not found', async () => {
      execute.mockRejectedValueOnce(new NotFoundException());
      const ctx: { req: { user: AuthenticatedSession } } = { req: { user: mockSession } };
      const result = await resolver.me(ctx);
      expect(result).toBeNull();
    });

    it('returns null when no session userId', async () => {
      const ctx = { req: { user: undefined } };
      const result = await resolver.me(ctx as unknown as { req: { user?: AuthenticatedSession } });
      expect(result).toBeNull();
    });
  });

  describe('users', () => {
    it('returns cursor-paginated users from the query bus', async () => {
      const result = await resolver.users({ limit: 20 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('u1');
      expect(result.hasMore).toBe(false);
      expect(result.lastCursor).toBe('dGVzdC1jdXJzb3I');
      expect(execute).toHaveBeenCalledWith(expect.any(ListUsersCursorQuery));
    });

    it('passes startingAfter to the query', async () => {
      const cursor = 'some-cursor';
      await resolver.users({ limit: 10, startingAfter: cursor });
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ startingAfter: cursor, limit: 10 }),
      );
    });

    it('returns null lastCursor when result has no items', async () => {
      execute.mockResolvedValueOnce({ data: [], hasMore: false, lastCursor: null });
      const result = await resolver.users({ limit: 20 });
      expect(result.lastCursor).toBeNull();
      expect(result.data).toHaveLength(0);
    });
  });
});
