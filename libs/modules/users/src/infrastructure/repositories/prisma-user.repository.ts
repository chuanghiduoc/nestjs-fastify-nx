import {
  Injectable,
  Logger,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@prisma/client';
import { User, UserRole, UserStatus } from '../../domain/entities/user.entity';
import type {
  FindAllOptions,
  FindAllResult,
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
        throw new ConflictException('A record with this value already exists');
      }
    }
    this.logger.error({ err, context }, 'Database operation failed');
    throw new InternalServerErrorException('Database error');
  }

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

  async findAll(options: FindAllOptions): Promise<FindAllResult> {
    const { page, limit, role, status, search } = options;
    const where: Prisma.UserWhereInput = {};
    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    try {
      const [rows, total] = await this.prisma.db.$transaction([
        this.prisma.db.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.db.user.count({ where }),
      ]);
      return { items: rows.map((row) => this.mapToEntity(row as UserRow)), total };
    } catch (err) {
      return this.handleError(err, 'findAll');
    }
  }

  async exists(email: string): Promise<boolean> {
    try {
      const count = await this.prisma.db.user.count({ where: { email } });
      return count > 0;
    } catch (err) {
      return this.handleError(err, 'exists');
    }
  }
}
