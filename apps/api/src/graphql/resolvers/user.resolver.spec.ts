import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserResolver } from './user.resolver';
import type { UserRepositoryPort, ListUsersHandler } from '@nestjs-fastify-nx/modules-users';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';

const mockUser = {
  id: 'u1',
  email: { toString: () => 'test@example.com' },
  name: 'Test User',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
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
  let mockRepo: UserRepositoryPort;
  let mockListHandler: ListUsersHandler;

  beforeEach(() => {
    mockRepo = {
      findById: vi.fn().mockResolvedValue(mockUser),
      findByEmail: vi.fn().mockResolvedValue(null),
      findAll: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      save: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
    };
    mockListHandler = {
      execute: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'u1',
            email: 'test@example.com',
            name: 'Test User',
            role: 'USER',
            status: 'ACTIVE',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-01'),
          },
        ],
        meta: {
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          hasPrevPage: false,
          hasNextPage: false,
        },
      }),
    } as unknown as ListUsersHandler;
    resolver = new UserResolver(mockRepo, mockListHandler);
  });

  describe('me', () => {
    it('returns user for authenticated request', async () => {
      const ctx: { req: { user: AuthenticatedSession } } = { req: { user: mockSession } };
      const result = await resolver.me(ctx);
      expect(result?.id).toBe('u1');
      expect(result?.email).toBe('test@example.com');
      expect(result?.name).toBe('Test User');
      expect(mockRepo.findById).toHaveBeenCalledWith('u1');
    });

    it('returns null when user is not found', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);
      const ctx: { req: { user: AuthenticatedSession } } = { req: { user: mockSession } };
      const result = await resolver.me(ctx);
      expect(result).toBeNull();
    });
  });

  describe('users', () => {
    it('returns paginated users page from handler', async () => {
      const result = await resolver.users(1, 20);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('u1');
      expect(result.meta.total).toBe(1);
      expect(mockListHandler.execute).toHaveBeenCalled();
    });
  });
});
