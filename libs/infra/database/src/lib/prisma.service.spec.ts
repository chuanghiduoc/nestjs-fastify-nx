import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaService } from './prisma.service';

/**
 * Unit tests for the two-client design in PrismaService.
 * These run without a real database — only the structural property is tested:
 * dbRead aliases to db when no replica URL is set, and diverges when
 * DATABASE_REPLICA_URL is provided. Prisma constructors accept the strings
 * but make no network calls until $connect() is invoked.
 */
describe('PrismaService — client aliasing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('dbRead aliases to db when DATABASE_REPLICA_URL is unset', () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    delete process.env['DATABASE_REPLICA_URL'];

    const svc = new PrismaService();

    // Both getters must return the same object reference — no second client created.
    expect(svc.dbRead).toBe(svc.db);
    expect(svc.hasReplica).toBe(false);
  });

  it('dbRead is a distinct client when DATABASE_REPLICA_URL is set', () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['DATABASE_REPLICA_URL'] = 'postgresql://test:test@replica:5432/test';

    const svc = new PrismaService();

    // Two separate PrismaClient instances — routing diverges.
    expect(svc.dbRead).not.toBe(svc.db);
    expect(svc.hasReplica).toBe(true);
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env['DATABASE_URL'];

    expect(() => new PrismaService()).toThrow('DATABASE_URL is required');
  });

  it('dbRead aliases to db when DATABASE_REPLICA_URL is an empty string', () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    // dotenv loads KEY= as "" which is not undefined — trim() must reduce it to falsy.
    process.env['DATABASE_REPLICA_URL'] = '';

    const svc = new PrismaService();

    expect(svc.dbRead).toBe(svc.db);
    expect(svc.hasReplica).toBe(false);
  });
});
