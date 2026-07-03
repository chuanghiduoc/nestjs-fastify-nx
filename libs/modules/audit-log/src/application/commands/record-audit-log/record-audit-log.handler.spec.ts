import { describe, expect, it, vi } from 'vitest';
import { RecordAuditLogHandler } from './record-audit-log.handler';
import { RecordAuditLogCommand } from './record-audit-log.command';
import type { AuditLogRepositoryPort } from '../../../domain/ports/audit-log-repository.port';
import { AuditLog } from '../../../domain/entities/audit-log.entity';

const EVT_ID = '00000000-0000-4000-8000-000000000001';

function buildHandler() {
  const repository: AuditLogRepositoryPort = { append: vi.fn().mockResolvedValue(undefined) };
  return { handler: new RecordAuditLogHandler(repository), repository };
}

function buildCommand(overrides: Partial<RecordAuditLogCommand> = {}): RecordAuditLogCommand {
  return new RecordAuditLogCommand(
    overrides.eventId ?? EVT_ID,
    overrides.userId ?? 'user-123',
    overrides.action ?? 'users.registered',
    overrides.resource ?? 'user',
    overrides.metadata ?? { email: 'a@example.com', eventId: EVT_ID },
    overrides.ipAddress ?? '203.0.113.5',
    overrides.userAgent ?? 'curl/8',
    overrides.occurredAt ?? new Date('2026-04-28T10:00:00.000Z'),
  );
}

describe('RecordAuditLogHandler', () => {
  it('builds an AuditLog entity from the command and appends it', async () => {
    const { handler, repository } = buildHandler();

    await handler.execute(buildCommand());

    expect(repository.append).toHaveBeenCalledTimes(1);
    const persisted = (repository.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as AuditLog;
    expect(persisted).toBeInstanceOf(AuditLog);
    expect(persisted.userId).toBe('user-123');
    expect(persisted.action).toBe('users.registered');
    expect(persisted.resource).toBe('user');
    expect(persisted.ipAddress).toBe('203.0.113.5');
    expect(persisted.userAgent).toBe('curl/8');
    expect(persisted.metadata).toEqual({ email: 'a@example.com', eventId: EVT_ID });
    expect(persisted.createdAt).toEqual(new Date('2026-04-28T10:00:00.000Z'));
  });

  it('derives the entity id from the command eventId so redelivery is idempotent', async () => {
    const { handler, repository } = buildHandler();

    await handler.execute(buildCommand({ eventId: EVT_ID, metadata: {} }));

    const persisted = (repository.append as ReturnType<typeof vi.fn>).mock.calls[0][0] as AuditLog;
    // Entity id equals the outbox eventId so a redelivered event maps to the same PK
    // (the repository treats the resulting P2002 as a no-op).
    expect(persisted.id).toBe(EVT_ID);
  });

  it('propagates repository errors so the command bus surfaces them to the listener', async () => {
    const repository: AuditLogRepositoryPort = {
      append: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const handler = new RecordAuditLogHandler(repository);

    await expect(handler.execute(buildCommand())).rejects.toThrow('db down');
  });
});
