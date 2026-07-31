import { isDomainException } from '@nestjs-fastify-nx/core';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User, UserRole, UserStatus } from '../../domain/entities/user.entity';
import { PrismaUserRepository } from './prisma-user.repository';

const now = new Date('2026-01-01T00:00:00.000Z');
const row = {
  id: 'u1',
  name: 'Alice',
  email: 'alice@example.com',
  emailVerified: true,
  image: null,
  role: 'USER',
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
};

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('sensitive database detail', {
    code,
    clientVersion: 'test',
  });
}

describe('PrismaUserRepository', () => {
  let db: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
  };
  let repository: PrismaUserRepository;

  beforeEach(() => {
    db = {
      user: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
    };
    repository = new PrismaUserRepository({
      db,
      dbRead: db,
      currentTransaction: undefined,
    } as unknown as PrismaService);
  });

  it('maps primary lookups to domain entities and handles missing records', async () => {
    db.user.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    expect((await repository.findById('u1'))?.email.toString()).toBe(row.email);
    expect(await repository.findByEmail('missing@example.com')).toBeNull();
  });

  // The filter maps Prisma codes far more precisely than this layer can (P2024/P2028 → 503 with a
  // retry, P2003 → 409). Collapsing them here told a client not to retry a pool timeout.
  it('rethrows a prisma failure untouched so the transport can classify it', async () => {
    const failure = knownError('P2024');
    db.user.findUnique.mockRejectedValueOnce(failure);
    await expect(repository.findById('u1')).rejects.toBe(failure);
  });

  it('saves an aggregate with an upsert', async () => {
    const user = User.reconstitute({
      id: row.id,
      name: row.name,
      email: row.email,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
    db.user.upsert.mockResolvedValueOnce(row);
    await repository.save(user);
    expect(db.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, create: expect.any(Object) }),
    );
  });

  it('escapes LIKE metacharacters and returns one page plus hasMore', async () => {
    db.user.findMany.mockResolvedValueOnce([row, { ...row, id: 'u2' }]);
    const result = await repository.findAllCursor({
      limit: 1,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      search: '50%_\\',
      startingAfter: { id: 'cursor', createdAt: now },
    });
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          OR: expect.arrayContaining([
            { email: { contains: '50\\%\\_\\\\', mode: 'insensitive' } },
          ]),
          AND: expect.any(Array),
        }),
        take: 2,
      }),
    );
  });

  it('reports existence from the replica count', async () => {
    db.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await repository.exists(row.email)).toBe(true);
    expect(await repository.exists('missing@example.com')).toBe(false);
  });

  it('translates a unique conflict and leaves every other failure alone', async () => {
    db.user.upsert.mockRejectedValueOnce(knownError('P2002'));
    const conflict = await repository
      .save(
        User.reconstitute({
          id: row.id,
          name: row.name,
          email: row.email,
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          createdAt: now,
          updatedAt: now,
        }),
      )
      .catch((err: unknown) => err);

    expect(isDomainException(conflict) && conflict.kind).toBe('conflict');
    expect(isDomainException(conflict) && conflict.code).toBe('user_already_exists');
    // A duplicate can be gone by the next attempt, so a retrying consumer must not park it.
    expect(isDomainException(conflict) && conflict.permanent).toBe(false);

    // The DSN in this message must never reach a client — the filter redacts every 5xx it emits.
    const leaky = new Error('postgresql://user:secret@db/app');
    db.user.findUnique.mockRejectedValueOnce(leaky);
    await expect(repository.findByEmail(row.email)).rejects.toBe(leaky);
  });
});
