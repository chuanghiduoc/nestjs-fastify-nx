import { describe, expect, it } from 'vitest';
import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import { AuditLog } from './audit-log.entity';

// audit_logs.id is a Postgres UUID column. Use a deterministic v4 UUID for
// idempotency-style tests instead of an opaque slug that would fail at the
// Prisma boundary in production.
const DETERMINISTIC_UUID = '00000000-0000-4000-8000-000000000001';

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

  describe('caller-supplied id (idempotency)', () => {
    it('uses a fresh random id when no id is supplied', () => {
      const a = AuditLog.create({ action: 'users.registered' });
      const b = AuditLog.create({ action: 'users.registered' });

      // Both ids must be valid UUIDs.
      expect(a.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(b.id).toMatch(/^[0-9a-f-]{36}$/i);
      // They must differ — generateId() produces unique values.
      expect(a.id).not.toBe(b.id);
    });

    it('uses the caller-supplied id when provided', () => {
      const entry = AuditLog.create({ id: DETERMINISTIC_UUID, action: 'users.logged_in' });
      expect(entry.id).toBe(DETERMINISTIC_UUID);
    });

    it('falls back to generateId() when id is undefined', () => {
      const entry = AuditLog.create({ id: undefined, action: 'users.logged_out' });
      expect(entry.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('throws a BusinessRuleException on empty-string id', () => {
      // `'' ?? x` is '' not x — an empty string id would silently reach
      // Postgres and fail as a UUID parse error rather than a domain assertion.
      expect(() => AuditLog.create({ id: '', action: 'users.registered' })).toThrow(
        BusinessRuleException,
      );
    });

    it('throws a BusinessRuleException on whitespace-only id', () => {
      expect(() => AuditLog.create({ id: '   ', action: 'users.registered' })).toThrow(
        BusinessRuleException,
      );
    });

    it('throws a BusinessRuleException when id is not a UUID', () => {
      // audit_logs.id is a Postgres UUID column; a non-UUID caller id would
      // otherwise blow up at write time as an opaque libpq parse error.
      expect(() =>
        AuditLog.create({ id: 'evt-deterministic-x', action: 'users.registered' }),
      ).toThrow(BusinessRuleException);
    });
  });
});
