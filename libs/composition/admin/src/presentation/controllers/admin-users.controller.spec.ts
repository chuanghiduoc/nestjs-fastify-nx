import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryBus } from '@nestjs/cqrs';
import {
  ListUsersCursorFilterDto,
  ListUsersCursorQuery,
  UserRole,
  UserStatus,
  type UserListItemDto,
} from '@nestjs-fastify-nx/modules-users';
import { AdminUsersController } from './admin-users.controller';

function createUserListItem(overrides: Partial<UserListItemDto> = {}): UserListItemDto {
  return {
    id: '019dd1a5-9235-70db-8d57-54ef901d8185',
    email: 'user@test.com',
    name: 'Test User',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminUsersController', () => {
  let queryBus: { execute: ReturnType<typeof vi.fn> };
  let controller: AdminUsersController;

  beforeEach(() => {
    queryBus = { execute: vi.fn() };
    controller = new AdminUsersController(queryBus as unknown as QueryBus);
  });

  it('dispatches a ListUsersCursorQuery built from the filter DTO', async () => {
    queryBus.execute.mockResolvedValue({ data: [], hasMore: false, lastCursor: null });
    const filter: ListUsersCursorFilterDto = Object.assign(new ListUsersCursorFilterDto(), {
      limit: 25,
      startingAfter: 'cursor-abc',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      search: 'jane',
    });

    await controller.list(filter);

    expect(queryBus.execute).toHaveBeenCalledTimes(1);
    const dispatched = queryBus.execute.mock.calls[0][0] as ListUsersCursorQuery;
    expect(dispatched).toBeInstanceOf(ListUsersCursorQuery);
    expect(dispatched).toMatchObject({
      limit: 25,
      startingAfter: 'cursor-abc',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      search: 'jane',
    });
  });

  it('maps the query result into the Stripe-style cursor envelope scoped to the admin/users URL', async () => {
    const items = [
      createUserListItem(),
      createUserListItem({ id: 'second-id', email: 'b@test.com' }),
    ];
    queryBus.execute.mockResolvedValue({ data: items, hasMore: true, lastCursor: 'next-cursor' });
    const filter: ListUsersCursorFilterDto = Object.assign(new ListUsersCursorFilterDto(), {
      limit: 10,
    });

    const result = await controller.list(filter);

    expect(result).toMatchObject({
      object: 'list',
      url: '/api/v1/admin/users',
      data: items,
      hasMore: true,
      lastCursor: 'next-cursor',
    });
  });

  it('returns an empty envelope with a null cursor when the query yields no rows', async () => {
    queryBus.execute.mockResolvedValue({ data: [], hasMore: false, lastCursor: null });
    const filter: ListUsersCursorFilterDto = Object.assign(new ListUsersCursorFilterDto(), {
      limit: 10,
    });

    const result = await controller.list(filter);

    expect(result.data).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.lastCursor).toBeNull();
  });
});
