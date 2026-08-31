import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import type {
  FindSessionsCursorOptions,
  FindSessionsCursorResult,
  SessionRecord,
  SessionRepositoryPort,
} from '../../domain/ports/session-repository.port';

const SESSION_FIELDS = {
  id: true,
  userId: true,
  ipAddress: true,
  userAgent: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PrismaSessionRepository implements SessionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAllCursor(options: FindSessionsCursorOptions): Promise<FindSessionsCursorResult> {
    const { userId, startingAfter, limit, activeOnly, now } = options;

    const where: Prisma.SessionWhereInput = { userId };
    if (activeOnly) where.expiresAt = { gt: now };
    if (startingAfter) {
      where.AND = [
        {
          OR: [
            { createdAt: { lt: startingAfter.createdAt } },
            { AND: [{ createdAt: startingAfter.createdAt }, { id: { lt: startingAfter.id } }] },
          ],
        },
      ];
    }

    // Primary, not a replica: a caller who just revoked a device must not be shown it again by a
    // lagging read.
    const rows = await this.prisma.writeTarget().session.findMany({
      where,
      select: SESSION_FIELDS,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  async findByIdForUser(userId: string, id: string): Promise<SessionRecord | null> {
    return this.prisma
      .writeTarget()
      .session.findFirst({ where: { id, userId }, select: SESSION_FIELDS });
  }

  async deleteForUser(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.writeTarget().session.deleteMany({ where: { id, userId } });
    return count > 0;
  }

  async deleteAllForUserExcept(userId: string, keepSessionId: string): Promise<number> {
    const { count } = await this.prisma
      .writeTarget()
      .session.deleteMany({ where: { userId, id: { not: keepSessionId } } });
    return count;
  }
}
