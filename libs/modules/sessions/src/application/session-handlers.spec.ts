import { beforeEach, describe, expect, it } from 'vitest';
import { generateId } from '@nestjs-fastify-nx/shared';
import { InMemorySessionRepository } from '../testing/in-memory-session-repository';
import { ListMySessionsHandler } from './queries/list-my-sessions/list-my-sessions.handler';
import { ListMySessionsQuery } from './queries/list-my-sessions/list-my-sessions.query';
import { RevokeSessionHandler } from './commands/revoke-session/revoke-session.handler';
import { RevokeSessionCommand } from './commands/revoke-session/revoke-session.command';
import { RevokeOtherSessionsHandler } from './commands/revoke-other-sessions/revoke-other-sessions.handler';
import { RevokeOtherSessionsCommand } from './commands/revoke-other-sessions/revoke-other-sessions.command';

const USER_ID = '019dd1a5-9235-70db-8d57-54ef91400001';
const OTHER_USER_ID = '019dd1a5-9235-70db-8d57-54ef91400002';

describe('session handlers', () => {
  let repository: InMemorySessionRepository;

  function seed(options: { userId?: string; expired?: boolean } = {}): string {
    const id = generateId();
    repository.seed({
      id,
      userId: options.userId ?? USER_ID,
      ipAddress: '203.0.113.9',
      userAgent: 'curl/8',
      expiresAt: options.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  beforeEach(() => {
    repository = new InMemorySessionRepository();
  });

  it('lists the caller’s sessions and flags the current one', async () => {
    const current = seed();
    seed();

    const result = await new ListMySessionsHandler(repository).execute(
      new ListMySessionsQuery(USER_ID, current, 20),
    );

    expect(result.data).toHaveLength(2);
    expect(result.data.filter((session) => session.current).map((session) => session.id)).toEqual([
      current,
    ]);
  });

  it('never projects the session token', async () => {
    const current = seed();

    const result = await new ListMySessionsHandler(repository).execute(
      new ListMySessionsQuery(USER_ID, current, 20),
    );

    expect(Object.keys(result.data[0])).not.toContain('token');
    expect(Object.keys(result.data[0])).not.toContain('sessionToken');
  });

  it('never lists a session belonging to another user', async () => {
    const current = seed();
    seed({ userId: OTHER_USER_ID });

    const result = await new ListMySessionsHandler(repository).execute(
      new ListMySessionsQuery(USER_ID, current, 20),
    );

    expect(result.data).toHaveLength(1);
  });

  it('hides expired sessions by default and shows them on request', async () => {
    const current = seed();
    seed({ expired: true });
    const handler = new ListMySessionsHandler(repository);

    const active = await handler.execute(new ListMySessionsQuery(USER_ID, current, 20));
    const all = await handler.execute(
      new ListMySessionsQuery(USER_ID, current, 20, { activeOnly: false }),
    );

    expect(active.data).toHaveLength(1);
    expect(all.data).toHaveLength(2);
  });

  it('rejects a malformed cursor', async () => {
    const execute = new ListMySessionsHandler(repository).execute(
      new ListMySessionsQuery(USER_ID, generateId(), 20, { startingAfter: 'bad!' }),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('revokes one of the caller’s sessions', async () => {
    const id = seed();

    await new RevokeSessionHandler(repository).execute(new RevokeSessionCommand(USER_ID, id));

    expect(await repository.findByIdForUser(USER_ID, id)).toBeNull();
  });

  // 404, not 403 — a distinguishable 403 would confirm the session id exists.
  it('answers not_found for a session of another user', async () => {
    const id = seed({ userId: OTHER_USER_ID });

    const execute = new RevokeSessionHandler(repository).execute(
      new RevokeSessionCommand(USER_ID, id),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
    expect(await repository.findByIdForUser(OTHER_USER_ID, id)).not.toBeNull();
  });

  it('answers not_found for an unknown session', async () => {
    const execute = new RevokeSessionHandler(repository).execute(
      new RevokeSessionCommand(USER_ID, generateId()),
    );

    await expect(execute).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('revokes every other session and keeps the current one', async () => {
    const current = seed();
    seed();
    seed();
    const otherUsers = seed({ userId: OTHER_USER_ID });

    const result = await new RevokeOtherSessionsHandler(repository).execute(
      new RevokeOtherSessionsCommand(USER_ID, current),
    );

    expect(result.revoked).toBe(2);
    expect(await repository.findByIdForUser(USER_ID, current)).not.toBeNull();
    expect(await repository.findByIdForUser(OTHER_USER_ID, otherUsers)).not.toBeNull();
  });
});
