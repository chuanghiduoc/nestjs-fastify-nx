import { Injectable, Logger } from '@nestjs/common';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { PrismaService, escapeLikePattern } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import { keysetAfter, takePage } from '@nestjs-fastify-nx/shared';
import { User, UserRole, UserStatus } from '../../domain/entities/user.entity';
import type {
  FindAllCursorOptions,
  FindAllCursorResult,
  UserRepositoryPort,
} from '../../domain/ports/user-repository.port';

type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  memberships?: Array<{ role: string }>;
};

@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  private readonly logger = new Logger(PrismaUserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  private get writer() {
    return this.prisma.writeTarget();
  }

  private get reader() {
    return this.prisma.readTarget();
  }

  private mapToEntity(raw: UserRow): User {
    return User.reconstitute({
      id: raw.id,
      name: raw.name,
      email: raw.email,
      role: raw.role as UserRole,
      status: raw.status as UserStatus,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  // Only the one condition this context can describe better than the transport is translated here.
  // Everything else is rethrown untouched: GlobalExceptionFilter already classifies Prisma codes
  // (P2003 → 409, P2024/P2028 → 503, unmapped → redacted 500), and collapsing them all into a 500
  // here turned a retryable pool timeout into a fault the client is told not to retry.
  private handleError(err: unknown, context: string): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DomainException({
        kind: 'conflict',
        // A duplicate can disappear before the next attempt.
        permanent: false,
        code: ERROR_CODES.USER_ALREADY_EXISTS,
        title: I18N_KEYS.common.conflict,
        messageKey: I18N_KEYS.errors.users.already_exists,
        violations: [
          {
            path: 'email',
            code: 'already_exists',
            message: 'A record with this value already exists',
            messageKey: I18N_KEYS.errors.users.already_exists,
          },
        ],
      });
    }
    this.logger.error({ err, context }, 'Database operation failed');
    throw err;
  }

  // Primary (not dbRead) — /users/me reads immediately after sign-up; replica lag would return null.
  async findById(id: string): Promise<User | null> {
    try {
      const raw = await this.writer.user.findUnique({ where: { id } });
      return raw ? this.mapToEntity(raw) : null;
    } catch (err) {
      return this.handleError(err, 'findById');
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      const raw = await this.writer.user.findUnique({ where: { email } });
      return raw ? this.mapToEntity(raw) : null;
    } catch (err) {
      return this.handleError(err, 'findByEmail');
    }
  }

  // Last-write-wins by design: this writes the whole aggregate from the caller's snapshot, with no
  // optimistic-concurrency guard. Two handlers that load → mutate → save the same user concurrently
  // therefore lose the earlier update. Safe for the single-writer flows this serves (seeding,
  // reconstitution); a concurrent update-user command would need an aggregate `version` column and a
  // CAS on it, which is a schema change and must not be retrofitted by widening this method.
  async save(user: User): Promise<void> {
    try {
      await this.writer.user.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          name: user.name,
          email: user.email.toString(),
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        update: {
          name: user.name,
          email: user.email.toString(),
          role: user.role,
          status: user.status,
          updatedAt: user.updatedAt,
        },
      });
    } catch (err) {
      return this.handleError(err, 'save');
    }
  }

  async findAllCursor(options: FindAllCursorOptions): Promise<FindAllCursorResult> {
    const { organizationId, startingAfter, limit, role, status, search } = options;
    const where: Prisma.UserWhereInput = {
      memberships: { some: { organizationId, ...(role ? { role } : {}) } },
    };
    if (status) where.status = status;
    if (search) {
      const escapedSearch = escapeLikePattern(search);
      where.OR = [
        { email: { contains: escapedSearch, mode: 'insensitive' } },
        { name: { contains: escapedSearch, mode: 'insensitive' } },
      ];
    }
    if (startingAfter) where.AND = [keysetAfter(startingAfter)];
    try {
      const rows = await this.reader.user.findMany({
        where,
        include: { memberships: { where: { organizationId }, select: { role: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const { items: page, hasMore } = takePage(rows, limit);
      const items = page.map((row) =>
        Object.assign(this.mapToEntity(row), {
          organizationRole: row.memberships?.[0]?.role ?? '',
        }),
      );
      return { items, hasMore };
    } catch (err) {
      return this.handleError(err, 'findAllCursor');
    }
  }
}
