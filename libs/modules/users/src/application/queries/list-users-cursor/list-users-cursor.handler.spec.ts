import { describe, it, expect, beforeEach } from 'vitest';
import { decodeCursor } from '@nestjs-fastify-nx/shared';
import { MockUserRepository } from '../../../testing/mock-user-repository';
import { UserFactory } from '../../../testing/user.factory';
import { ListUsersCursorHandler } from './list-users-cursor.handler';
import { ListUsersCursorQuery } from './list-users-cursor.query';
import type { User } from '../../../domain/entities/user.entity';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90300001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef90300002';

describe('ListUsersCursorHandler', () => {
  let repo: MockUserRepository;
  let handler: ListUsersCursorHandler;

  async function seedMember(
    overrides: Partial<{ email: string; name: string }> = {},
    organizationId = ORG_ID,
    role = 'member',
  ): Promise<User> {
    const user = UserFactory.create(overrides);
    await repo.save(user);
    repo.addMembership(user.id, organizationId, role);
    return user;
  }

  beforeEach(() => {
    repo = new MockUserRepository();
    // Inject repo directly (bypasses NestJS DI in unit tests)
    handler = new ListUsersCursorHandler(repo as never);
    UserFactory.reset();
    repo.clear();
  });

  it('returns first page with hasMore=false when items <= limit', async () => {
    await seedMember({ email: 'a@test.com' });
    await seedMember({ email: 'b@test.com' });

    const result = await handler.execute(new ListUsersCursorQuery(ORG_ID, 10));

    expect(result.data).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.lastCursor).not.toBeNull();
  });

  it('returns first page with hasMore=true when items exceed limit', async () => {
    for (let i = 0; i < 5; i++) {
      await seedMember({ email: `user${i}@test.com` });
    }

    const result = await handler.execute(new ListUsersCursorQuery(ORG_ID, 3));

    expect(result.data).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.lastCursor).not.toBeNull();
  });

  it('returns empty result with null lastCursor when store is empty', async () => {
    const result = await handler.execute(new ListUsersCursorQuery(ORG_ID, 20));

    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.lastCursor).toBeNull();
  });

  it('never returns a user who belongs to another organization', async () => {
    await seedMember({ email: 'mine@test.com' }, ORG_ID);
    await seedMember({ email: 'theirs@test.com' }, OTHER_ORG_ID);

    const result = await handler.execute(new ListUsersCursorQuery(ORG_ID, 10));

    expect(result.data.map((u) => u.email)).toEqual(['mine@test.com']);
  });

  it('excludes a user with no membership at all', async () => {
    await repo.save(UserFactory.create({ email: 'orphan@test.com' }));

    const result = await handler.execute(new ListUsersCursorQuery(ORG_ID, 10));

    expect(result.data).toHaveLength(0);
  });

  it('lastCursor decodes to createdAt + id of last item in data', async () => {
    for (let i = 0; i < 3; i++) {
      await seedMember({ email: `u${i}@test.com` });
    }

    const result = await handler.execute(new ListUsersCursorQuery(ORG_ID, 10));
    const last = result.data[result.data.length - 1];
    const decoded = decodeCursor(result.lastCursor ?? '');

    expect(decoded).not.toBeNull();
    if (!decoded) throw new Error('cursor must decode');
    expect(decoded.id).toBe(last.id);
    expect(decoded.createdAt.toISOString()).toBe(new Date(last.createdAt).toISOString());
  });

  it('second page via startingAfter does not overlap first page', async () => {
    for (let i = 0; i < 5; i++) {
      await seedMember({ email: `p${i}@test.com` });
    }

    const page1 = await handler.execute(new ListUsersCursorQuery(ORG_ID, 3));
    expect(page1.hasMore).toBe(true);

    const page2 = await handler.execute(
      new ListUsersCursorQuery(ORG_ID, 3, { startingAfter: page1.lastCursor ?? undefined }),
    );

    const page1Ids = new Set(page1.data.map((u) => u.id));
    for (const item of page2.data) {
      expect(page1Ids.has(item.id)).toBe(false);
    }
    expect(page2.data.length).toBeGreaterThan(0);
  });

  it('rejects an invalid startingAfter cursor instead of returning the first page', async () => {
    await seedMember({ email: 'x@test.com' });

    // Asserted on the domain kind, not an HTTP status: this layer runs under REST, GraphQL and the
    // scheduler, and only the transport knows that `malformed` means 400.
    await expect(
      handler.execute(new ListUsersCursorQuery(ORG_ID, 10, { startingAfter: '!!!invalid!!!' })),
    ).rejects.toMatchObject({ kind: 'malformed', code: 'invalid_cursor', permanent: true });
  });

  it('maps domain User fields to UserListItemDto correctly', async () => {
    await seedMember({ email: 'dto@test.com', name: 'DTO User' });

    const result = await handler.execute(new ListUsersCursorQuery(ORG_ID, 10));
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
