import {
  Injectable,
  Logger,
  ConflictException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@prisma/client';
import { decodeCursor } from '@nestjs-fastify-nx/shared';
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
};

@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  private readonly logger = new Logger(PrismaUserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

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

  private handleError(err: unknown, context: string): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          messageKey: I18N_KEYS.errors.users.already_exists,
          message: 'A record with this value already exists',
        });
      }
    }
    this.logger.error({ err, context }, 'Database operation failed');
    throw new InternalServerErrorException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      messageKey: I18N_KEYS.errors.users.database_error,
      message: 'Database error',
    });
  }

  // Primary (not dbRead) — /users/me reads immediately after sign-up; replica lag would return null.
  async findById(id: string): Promise<User | null> {
    try {
      const raw = await this.prisma.db.user.findUnique({ where: { id } });
      return raw ? this.mapToEntity(raw as UserRow) : null;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return null;
      }
      return this.handleError(err, 'findById');
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      const raw = await this.prisma.db.user.findUnique({ where: { email } });
      return raw ? this.mapToEntity(raw as UserRow) : null;
    } catch (err) {
      return this.handleError(err, 'findByEmail');
    }
  }

  async save(user: User): Promise<void> {
    try {
      await this.prisma.db.user.upsert({
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
    const { startingAfter, limit, role, status, search } = options;
    const where: Prisma.UserWhereInput = {};
    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (startingAfter) {
      const decoded = decodeCursor(startingAfter);
      if (decoded) {
        where.AND = [
          {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              { AND: [{ createdAt: decoded.createdAt }, { id: { lt: decoded.id } }] },
            ],
          },
        ];
      }
      // Invalid cursor → first page; decodeCursor returns null silently.
    }
    try {
      const rows = await this.prisma.dbRead.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map((row) =>
        this.mapToEntity(row as UserRow),
      );
      return { items, hasMore };
    } catch (err) {
      return this.handleError(err, 'findAllCursor');
    }
  }

  async exists(email: string): Promise<boolean> {
    try {
      const count = await this.prisma.dbRead.user.count({ where: { email } });
      return count > 0;
    } catch (err) {
      return this.handleError(err, 'exists');
    }
  }
}
