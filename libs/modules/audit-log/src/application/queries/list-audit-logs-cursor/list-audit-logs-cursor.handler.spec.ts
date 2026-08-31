import { describe, it, expect, beforeEach } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { decodeCursor, encodeCursor, generateId } from '@nestjs-fastify-nx/shared';
import { AuditLog } from '../../../domain/entities/audit-log.entity';
import { MockAuditLogRepository } from '../../../testing/mock-audit-log-repository';
import { ListAuditLogsCursorHandler } from './list-audit-logs-cursor.handler';
import { ListAuditLogsCursorQuery } from './list-audit-logs-cursor.query';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90400001';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef90400002';
const ACTOR_ID = '019dd1a5-9235-70db-8d57-54ef90400010';
const BASE_TIME = new Date('2026-08-01T00:00:00.000Z');

function entryAt(
  minutesFromBase: number,
  overrides: Partial<{
    organizationId: string;
    action: string;
    resource: string;
    userId: string;
  }> = {},
): AuditLog {
  return AuditLog.create({
    id: generateId(),
    organizationId: overrides.organizationId ?? ORG_ID,
    userId: overrides.userId ?? ACTOR_ID,
    action: overrides.action ?? 'users.registered',
    resource: overrides.resource ?? 'user',
    metadata: { source: 'test' },
    occurredAt: new Date(BASE_TIME.getTime() + minutesFromBase * 60_000),
  });
}

describe('ListAuditLogsCursorHandler', () => {
  let repository: MockAuditLogRepository;
  let handler: ListAuditLogsCursorHandler;

  beforeEach(() => {
    repository = new MockAuditLogRepository();
    handler = new ListAuditLogsCursorHandler(repository);
  });

  it('returns entries newest first', async () => {
    await repository.append(entryAt(0));
    await repository.append(entryAt(10));
    await repository.append(entryAt(5));

    const result = await handler.execute(new ListAuditLogsCursorQuery(ORG_ID, 20));

    expect(result.data.map((entry) => entry.createdAt.toISOString())).toEqual([
      new Date(BASE_TIME.getTime() + 10 * 60_000).toISOString(),
      new Date(BASE_TIME.getTime() + 5 * 60_000).toISOString(),
      BASE_TIME.toISOString(),
    ]);
    expect(result.hasMore).toBe(false);
  });

  it('reports hasMore and a cursor pointing at the last returned entry', async () => {
    for (let index = 0; index < 5; index += 1) await repository.append(entryAt(index));

    const result = await handler.execute(new ListAuditLogsCursorQuery(ORG_ID, 3));

    expect(result.data).toHaveLength(3);
    expect(result.hasMore).toBe(true);

    const decoded = decodeCursor(result.lastCursor ?? '');
    const last = result.data[result.data.length - 1];
    expect(decoded?.id).toBe(last.id);
    expect(decoded?.createdAt.toISOString()).toBe(last.createdAt.toISOString());
  });

  it('continues from a cursor without repeating entries', async () => {
    for (let index = 0; index < 5; index += 1) await repository.append(entryAt(index));

    const firstPage = await handler.execute(new ListAuditLogsCursorQuery(ORG_ID, 2));
    const secondPage = await handler.execute(
      new ListAuditLogsCursorQuery(ORG_ID, 2, { startingAfter: firstPage.lastCursor ?? undefined }),
    );

    const firstIds = firstPage.data.map((entry) => entry.id);
    const secondIds = secondPage.data.map((entry) => entry.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    expect(secondPage.data).toHaveLength(2);
    expect(secondPage.hasMore).toBe(true);
  });

  it('returns an empty page with a null cursor when nothing matches', async () => {
    const result = await handler.execute(new ListAuditLogsCursorQuery(ORG_ID, 20));

    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.lastCursor).toBeNull();
  });

  it('never returns entries belonging to another organization', async () => {
    await repository.append(entryAt(0, { organizationId: OTHER_ORG_ID }));
    await repository.append(entryAt(1));

    const result = await handler.execute(new ListAuditLogsCursorQuery(ORG_ID, 20));

    expect(result.data).toHaveLength(1);
    expect(result.data[0].organizationId).toBe(ORG_ID);
  });

  it('filters by action, resource and userId', async () => {
    await repository.append(entryAt(0, { action: 'users.registered' }));
    await repository.append(entryAt(1, { action: 'users.logged_in' }));
    await repository.append(entryAt(2, { action: 'users.logged_in', resource: 'organization' }));
    await repository.append(entryAt(3, { action: 'users.logged_in', userId: generateId() }));

    const byAction = await handler.execute(
      new ListAuditLogsCursorQuery(ORG_ID, 20, { action: 'users.logged_in' }),
    );
    const byResource = await handler.execute(
      new ListAuditLogsCursorQuery(ORG_ID, 20, { resource: 'organization' }),
    );
    const byUser = await handler.execute(
      new ListAuditLogsCursorQuery(ORG_ID, 20, { userId: ACTOR_ID }),
    );

    expect(byAction.data).toHaveLength(3);
    expect(byResource.data).toHaveLength(1);
    expect(byUser.data).toHaveLength(3);
  });

  it('filters by an inclusive occurredFrom/occurredUntil window', async () => {
    await repository.append(entryAt(0));
    await repository.append(entryAt(10));
    await repository.append(entryAt(20));

    const result = await handler.execute(
      new ListAuditLogsCursorQuery(ORG_ID, 20, {
        occurredFrom: new Date(BASE_TIME.getTime() + 10 * 60_000),
        occurredUntil: new Date(BASE_TIME.getTime() + 20 * 60_000),
      }),
    );

    expect(result.data).toHaveLength(2);
  });

  it('rejects a window whose lower bound is after its upper bound', async () => {
    const execute = handler.execute(
      new ListAuditLogsCursorQuery(ORG_ID, 20, {
        occurredFrom: new Date(BASE_TIME.getTime() + 60_000),
        occurredUntil: BASE_TIME,
      }),
    );

    await expect(execute).rejects.toBeInstanceOf(DomainException);
    await expect(execute).rejects.toMatchObject({ kind: 'validation' });
  });

  it('rejects a malformed cursor as a client-side parse failure', async () => {
    const execute = handler.execute(
      new ListAuditLogsCursorQuery(ORG_ID, 20, { startingAfter: '!!!not-a-cursor!!!' }),
    );

    await expect(execute).rejects.toBeInstanceOf(DomainException);
    await expect(execute).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('accepts a well-formed cursor that matches no entry', async () => {
    await repository.append(entryAt(0));

    const result = await handler.execute(
      new ListAuditLogsCursorQuery(ORG_ID, 20, {
        startingAfter: encodeCursor(new Date(BASE_TIME.getTime() - 60_000), generateId()),
      }),
    );

    expect(result.data).toHaveLength(0);
    expect(result.lastCursor).toBeNull();
  });
});
