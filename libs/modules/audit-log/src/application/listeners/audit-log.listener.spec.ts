import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { AuditLogListener } from './audit-log.listener';
import type { AuditLogRepositoryPort } from '../../domain/ports/audit-log-repository.port';
import { AuditLog } from '../../domain/entities/audit-log.entity';

function buildListener() {
  const repository: AuditLogRepositoryPort = {
    append: vi.fn().mockResolvedValue(undefined),
  };
  const listener = new AuditLogListener(repository);
  return { listener, repository };
}

describe('AuditLogListener', () => {
  it('persists user events with normalized metadata, ip, and userAgent', async () => {
    const { listener, repository } = buildListener();
    const event: DomainEvent = {
      eventId: 'evt-1',
      eventType: 'users.registered',
      occurredAt: new Date('2026-04-28T10:00:00.000Z'),
      aggregateId: 'user-123',
      payload: { email: 'a@example.com', ip: '203.0.113.5', userAgent: 'curl/8' },
    };

    await listener.handleUserEvent(event);

    expect(repository.append).toHaveBeenCalledTimes(1);
    const persisted = (repository.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as AuditLog;
    expect(persisted).toBeInstanceOf(AuditLog);
    expect(persisted.userId).toBe('user-123');
    expect(persisted.action).toBe('users.registered');
    expect(persisted.resource).toBe('user');
    expect(persisted.ipAddress).toBe('203.0.113.5');
    expect(persisted.userAgent).toBe('curl/8');
    expect(persisted.metadata).toEqual({ email: 'a@example.com', eventId: 'evt-1' });
    expect(persisted.createdAt).toEqual(event.occurredAt);
  });

  it('falls back to null when payload omits ip or userAgent', async () => {
    const { listener, repository } = buildListener();
    const event: DomainEvent = {
      eventId: 'evt-2',
      eventType: 'users.logged_out',
      occurredAt: new Date('2026-04-28T11:00:00.000Z'),
      aggregateId: 'user-456',
      payload: { tokenId: 'tok-1' },
    };

    await listener.handleUserEvent(event);

    const persisted = (repository.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as AuditLog;
    expect(persisted.ipAddress).toBeNull();
    expect(persisted.userAgent).toBeNull();
    expect(persisted.metadata).toEqual({ tokenId: 'tok-1', eventId: 'evt-2' });
  });

  it('propagates repository errors so the outbox relay marks lastError', async () => {
    const repository: AuditLogRepositoryPort = {
      append: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const listener = new AuditLogListener(repository);
    const event: DomainEvent = {
      eventId: 'evt-3',
      eventType: 'users.logged_in',
      occurredAt: new Date(),
      aggregateId: 'user-789',
      payload: {},
    };

    // Errors bubble up to EventEmitter2 (ignoreErrors: false) which lets the
    // outbox relay record lastError instead of marking the row processed.
    await expect(listener.handleUserEvent(event)).rejects.toThrow('db down');
  });
});
