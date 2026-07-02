import { describe, expect, it, vi } from 'vitest';
import type { CommandBus } from '@nestjs/cqrs';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { AuditLogListener } from './audit-log.listener';
import { RecordAuditLogCommand } from '../commands/record-audit-log/record-audit-log.command';

// Outbox eventIds are UUIDs in production (see prisma trigger / OutboxPublisher);
// fixed test UUIDs keep idempotency assertions deterministic without leaking
// production-shaped data into specs.
const EVT_REGISTERED = '00000000-0000-4000-8000-000000000001';
const EVT_DETERMINISTIC = '00000000-0000-4000-8000-000000000002';
const EVT_LOGGED_OUT = '00000000-0000-4000-8000-000000000004';
const EVT_LOGGED_IN = '00000000-0000-4000-8000-000000000005';

function buildListener() {
  const commandBus = { execute: vi.fn().mockResolvedValue(undefined) };
  const listener = new AuditLogListener(commandBus as unknown as CommandBus);
  return { listener, commandBus };
}

function dispatchedCommand(commandBus: {
  execute: ReturnType<typeof vi.fn>;
}): RecordAuditLogCommand {
  return commandBus.execute.mock.calls[0][0] as RecordAuditLogCommand;
}

describe('AuditLogListener', () => {
  it('dispatches RecordAuditLogCommand with normalized metadata, ip, and userAgent', async () => {
    const { listener, commandBus } = buildListener();
    const event: DomainEvent = {
      eventId: EVT_REGISTERED,
      eventType: 'users.registered',
      occurredAt: new Date('2026-04-28T10:00:00.000Z'),
      aggregateId: 'user-123',
      payload: { email: 'a@example.com', ip: '203.0.113.5', userAgent: 'curl/8' },
    };

    await listener.handleUserEvent(event);

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    const command = dispatchedCommand(commandBus);
    expect(command).toBeInstanceOf(RecordAuditLogCommand);
    expect(command.userId).toBe('user-123');
    expect(command.action).toBe('users.registered');
    expect(command.resource).toBe('user');
    expect(command.ipAddress).toBe('203.0.113.5');
    expect(command.userAgent).toBe('curl/8');
    expect(command.metadata).toEqual({ email: 'a@example.com', eventId: EVT_REGISTERED });
    expect(command.occurredAt).toEqual(event.occurredAt);
  });

  it('uses event.eventId as the command eventId (idempotency source)', async () => {
    const { listener, commandBus } = buildListener();
    const event: DomainEvent = {
      eventId: EVT_DETERMINISTIC,
      eventType: 'users.registered',
      occurredAt: new Date('2026-04-28T10:00:00.000Z'),
      aggregateId: 'user-999',
      payload: {},
    };

    await listener.handleUserEvent(event);

    // The command carries the outbox eventId so the handler derives a stable entity id;
    // redelivery of the same event produces the same primary key (P2002 no-op in the repo).
    expect(dispatchedCommand(commandBus).eventId).toBe(EVT_DETERMINISTIC);
  });

  it('falls back to null when payload omits ip or userAgent', async () => {
    const { listener, commandBus } = buildListener();
    const event: DomainEvent = {
      eventId: EVT_LOGGED_OUT,
      eventType: 'users.logged_out',
      occurredAt: new Date('2026-04-28T11:00:00.000Z'),
      aggregateId: 'user-456',
      payload: { tokenId: 'tok-1' },
    };

    await listener.handleUserEvent(event);

    const command = dispatchedCommand(commandBus);
    expect(command.ipAddress).toBeNull();
    expect(command.userAgent).toBeNull();
    expect(command.metadata).toEqual({ tokenId: 'tok-1', eventId: EVT_LOGGED_OUT });
  });

  it('propagates command bus errors so the outbox relay marks lastError', async () => {
    const commandBus = { execute: vi.fn().mockRejectedValue(new Error('db down')) };
    const listener = new AuditLogListener(commandBus as unknown as CommandBus);
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
