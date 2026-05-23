import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { AuditLogListener } from './audit-log.listener';
import type { AuditLogRepositoryPort } from '../../domain/ports/audit-log-repository.port';
import { AuditLog } from '../../domain/entities/audit-log.entity';

// Outbox eventIds are UUIDs in production (see prisma trigger / OutboxPublisher);
// fixed test UUIDs keep idempotency assertions deterministic without leaking
// production-shaped data into specs.
const EVT_REGISTERED = '00000000-0000-4000-8000-000000000001';
const EVT_DETERMINISTIC = '00000000-0000-4000-8000-000000000002';
const EVT_REPLAY = '00000000-0000-4000-8000-000000000003';
const EVT_LOGGED_OUT = '00000000-0000-4000-8000-000000000004';
const EVT_LOGGED_IN = '00000000-0000-4000-8000-000000000005';

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
      eventId: EVT_REGISTERED,
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
    expect(persisted.metadata).toEqual({ email: 'a@example.com', eventId: EVT_REGISTERED });
    expect(persisted.createdAt).toEqual(event.occurredAt);
  });

  it('uses event.eventId as the audit log entity id (idempotency)', async () => {
    const { listener, repository } = buildListener();
    const event: DomainEvent = {
      eventId: EVT_DETERMINISTIC,
      eventType: 'users.registered',
      occurredAt: new Date('2026-04-28T10:00:00.000Z'),
      aggregateId: 'user-999',
      payload: {},
    };

    await listener.handleUserEvent(event);

    const persisted = (repository.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as AuditLog;
    // The entity id must equal the outbox eventId so redelivery of the same
    // event produces the same primary key (P2002 no-op in the repository).
    expect(persisted.id).toBe(EVT_DETERMINISTIC);
  });

  it('two calls with the same eventId produce the same entity id', async () => {
    const { listener, repository } = buildListener();
    const event: DomainEvent = {
      eventId: EVT_REPLAY,
      eventType: 'users.logged_in',
      occurredAt: new Date('2026-04-28T12:00:00.000Z'),
      aggregateId: 'user-111',
      payload: {},
    };

    await listener.handleUserEvent(event);
    await listener.handleUserEvent(event);

    const calls = (repository.append as ReturnType<typeof vi.fn>).mock.calls;
    const firstId = (calls[0][0] as AuditLog).id;
    const secondId = (calls[1][0] as AuditLog).id;
    expect(firstId).toBe(EVT_REPLAY);
    expect(secondId).toBe(EVT_REPLAY);
  });

  it('falls back to null when payload omits ip or userAgent', async () => {
    const { listener, repository } = buildListener();
    const event: DomainEvent = {
      eventId: EVT_LOGGED_OUT,
      eventType: 'users.logged_out',
      occurredAt: new Date('2026-04-28T11:00:00.000Z'),
      aggregateId: 'user-456',
      payload: { tokenId: 'tok-1' },
    };

    await listener.handleUserEvent(event);

    const persisted = (repository.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as AuditLog;
    expect(persisted.ipAddress).toBeNull();
    expect(persisted.userAgent).toBeNull();
    expect(persisted.metadata).toEqual({ tokenId: 'tok-1', eventId: EVT_LOGGED_OUT });
  });

  it('propagates repository errors so the outbox relay marks lastError', async () => {
    const repository: AuditLogRepositoryPort = {
      append: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const listener = new AuditLogListener(repository);
    const event: DomainEvent = {
      eventId: EVT_LOGGED_IN,
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
