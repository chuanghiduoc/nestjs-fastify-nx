import { describe, it, expect, beforeEach } from 'vitest';
import { decodeCursor } from '@nestjs-fastify-nx/shared';
import { MockUserRepository } from '../../../testing/mock-user-repository';
import { UserFactory } from '../../../testing/user.factory';
import { ListUsersCursorHandler } from './list-users-cursor.handler';
import { ListUsersCursorQuery } from './list-users-cursor.query';

describe('ListUsersCursorHandler', () => {
  let repo: MockUserRepository;
  let handler: ListUsersCursorHandler;

  beforeEach(() => {
    repo = new MockUserRepository();
    // Inject repo directly (bypasses NestJS DI in unit tests)
    handler = new ListUsersCursorHandler(repo as never);
    UserFactory.reset();
    repo.clear();
  });

  it('returns first page with hasMore=false when items <= limit', async () => {
    await repo.save(UserFactory.create({ email: 'a@test.com' }));
    await repo.save(UserFactory.create({ email: 'b@test.com' }));

    const result = await handler.execute(new ListUsersCursorQuery(10));

    expect(result.data).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.lastCursor).not.toBeNull();
  });

  it('returns first page with hasMore=true when items exceed limit', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.save(UserFactory.create({ email: `user${i}@test.com` }));
    }

    const result = await handler.execute(new ListUsersCursorQuery(3));

    expect(result.data).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.lastCursor).not.toBeNull();
  });

  it('returns empty result with null lastCursor when store is empty', async () => {
    const result = await handler.execute(new ListUsersCursorQuery(20));

    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.lastCursor).toBeNull();
  });

  it('lastCursor decodes to createdAt + id of last item in data', async () => {
    for (let i = 0; i < 3; i++) {
      await repo.save(UserFactory.create({ email: `u${i}@test.com` }));
    }

    const result = await handler.execute(new ListUsersCursorQuery(10));
    const last = result.data[result.data.length - 1];
    const decoded = decodeCursor(result.lastCursor ?? '');

    expect(decoded).not.toBeNull();
    if (!decoded) throw new Error('cursor must decode');
    expect(decoded.id).toBe(last.id);
    expect(decoded.createdAt.toISOString()).toBe(new Date(last.createdAt).toISOString());
  });

  it('second page via startingAfter does not overlap first page', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.save(UserFactory.create({ email: `p${i}@test.com` }));
    }

    const page1 = await handler.execute(new ListUsersCursorQuery(3));
    expect(page1.hasMore).toBe(true);

    const page2 = await handler.execute(new ListUsersCursorQuery(3, page1.lastCursor ?? undefined));

    const page1Ids = new Set(page1.data.map((u) => u.id));
    for (const item of page2.data) {
      expect(page1Ids.has(item.id)).toBe(false);
    }
    expect(page2.data.length).toBeGreaterThan(0);
  });

  it('invalid startingAfter cursor is treated as first page', async () => {
    await repo.save(UserFactory.create({ email: 'x@test.com' }));

    const result = await handler.execute(new ListUsersCursorQuery(10, '!!!invalid!!!'));

    // Invalid cursor → fallback to first page; should still return the item
    expect(result.data).toHaveLength(1);
  });

  it('maps domain User fields to UserListItemDto correctly', async () => {
    await repo.save(UserFactory.create({ email: 'dto@test.com', name: 'DTO User' }));

    const result = await handler.execute(new ListUsersCursorQuery(10));
    const item = result.data[0];

    expect(item.email).toBe('dto@test.com');
    expect(item.name).toBe('DTO User');
    expect(item.id).toBeDefined();
    expect(item.role).toBeDefined();
    expect(item.status).toBeDefined();
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
  });
});
