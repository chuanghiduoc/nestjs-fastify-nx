import { describe, expect, it } from 'vitest';
import { AuditLog } from './audit-log.entity';

describe('AuditLog entity', () => {
  it('creates an entry with generated id and default metadata', () => {
    const entry = AuditLog.create({ action: 'users.registered' });

    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(entry.action).toBe('users.registered');
    expect(entry.userId).toBeNull();
    expect(entry.resource).toBeNull();
    expect(entry.metadata).toEqual({});
    expect(entry.ipAddress).toBeNull();
    expect(entry.userAgent).toBeNull();
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('preserves provided fields exactly', () => {
    const occurredAt = new Date('2026-04-28T10:00:00.000Z');
    const entry = AuditLog.create({
      userId: 'u-1',
      action: 'users.logged_in',
      resource: 'user',
      metadata: { foo: 'bar' },
      ipAddress: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
      occurredAt,
    });

    expect(entry.userId).toBe('u-1');
    expect(entry.action).toBe('users.logged_in');
    expect(entry.resource).toBe('user');
    expect(entry.metadata).toEqual({ foo: 'bar' });
    expect(entry.ipAddress).toBe('203.0.113.5');
    expect(entry.userAgent).toBe('Mozilla/5.0');
    expect(entry.createdAt).toBe(occurredAt);
  });

  it('reconstitutes from persistence without mutating', () => {
    const props = {
      id: '00000000-0000-0000-0000-000000000001',
      userId: 'u-2',
      action: 'users.logged_out',
      resource: 'user',
      metadata: { tokenId: 't-1' },
      ipAddress: null,
      userAgent: null,
      createdAt: new Date('2026-04-28T11:00:00.000Z'),
    };
    const entry = AuditLog.reconstitute(props);

    expect(entry.id).toBe(props.id);
    expect(entry.metadata).toEqual({ tokenId: 't-1' });
  });
});
