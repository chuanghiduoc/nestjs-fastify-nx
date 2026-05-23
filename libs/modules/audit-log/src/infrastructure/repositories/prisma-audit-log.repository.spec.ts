import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PrismaAuditLogRepository } from './prisma-audit-log.repository';
import { AuditLog } from '../../domain/entities/audit-log.entity';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';

function makeP2002Error(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: { target: ['id'] },
  });
}

function makeOtherPrismaError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
    code: 'P2003',
    clientVersion: '7.0.0',
    meta: {},
  });
}

function buildRepository(createImpl: () => Promise<unknown>) {
  const prisma = {
    db: {
      auditLog: {
        create: vi.fn().mockImplementation(createImpl),
      },
    },
  } as unknown as PrismaService;
  return new PrismaAuditLogRepository(prisma);
}

function makeEntry(id = 'aaaaaaaa-0000-0000-0000-000000000001') {
  return AuditLog.create({ id, action: 'users.registered' });
}

describe('PrismaAuditLogRepository (unit)', () => {
  it('resolves when INSERT succeeds', async () => {
    const repo = buildRepository(() => Promise.resolve({ id: 'x' }));
    await expect(repo.append(makeEntry())).resolves.toBeUndefined();
  });

  it('swallows P2002 (duplicate PK on outbox redelivery) and resolves', async () => {
    const repo = buildRepository(() => Promise.reject(makeP2002Error()));
    // Must not throw — duplicate is a no-op.
    await expect(repo.append(makeEntry())).resolves.toBeUndefined();
  });

  it('re-throws non-P2002 Prisma errors so the outbox relay records lastError', async () => {
    const repo = buildRepository(() => Promise.reject(makeOtherPrismaError()));
    await expect(repo.append(makeEntry())).rejects.toThrow('Foreign key constraint failed');
  });

  it('re-throws generic (non-Prisma) errors', async () => {
    const repo = buildRepository(() => Promise.reject(new Error('connection reset')));
    await expect(repo.append(makeEntry())).rejects.toThrow('connection reset');
  });
});
