import { Injectable } from '@nestjs/common';
import { PrismaService, escapeLikePattern } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import { keysetAfter, takePage } from '@nestjs-fastify-nx/shared';
import { Team } from '../../domain/entities/team.entity';
import type {
  FindTeamsCursorOptions,
  FindTeamsCursorResult,
  TeamRepositoryPort,
  TeamWithMemberCount,
} from '../../domain/ports/team-repository.port';
import { teamNameTaken } from '../../application/organization-errors';

type TeamRow = {
  id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date | null;
  _count?: { members: number };
};

function toEntity(row: TeamRow): TeamWithMemberCount {
  return Object.assign(
    Team.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    { memberCount: row._count?.members ?? 0 },
  );
}

@Injectable()
export class PrismaTeamRepository implements TeamRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAllCursor(options: FindTeamsCursorOptions): Promise<FindTeamsCursorResult> {
    const { organizationId, startingAfter, limit, search } = options;

    const where: Prisma.TeamWhereInput = { organizationId };
    if (search) {
      where.name = { contains: escapeLikePattern(search), mode: 'insensitive' };
    }
    if (startingAfter) where.AND = [keysetAfter(startingAfter)];

    const rows = await this.prisma.readTarget().team.findMany({
      where,
      include: { _count: { select: { members: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const { items, hasMore } = takePage(rows, limit);
    return { items: items.map(toEntity), hasMore };
  }

  async findById(organizationId: string, id: string): Promise<TeamWithMemberCount | null> {
    const row = await this.prisma.writeTarget().team.findFirst({
      where: { id, organizationId },
      include: { _count: { select: { members: true } } },
    });
    return row ? toEntity(row) : null;
  }

  async create(team: Team): Promise<void> {
    try {
      await this.prisma.writeTarget().team.create({
        data: {
          id: team.id,
          organizationId: team.organizationId,
          name: team.name,
          createdAt: team.createdAt,
        },
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  async update(team: Team): Promise<boolean> {
    try {
      const { count } = await this.prisma.writeTarget().team.updateMany({
        where: { id: team.id, organizationId: team.organizationId },
        data: { name: team.name },
      });
      return count > 0;
    } catch (err) {
      throw this.translate(err);
    }
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma
      .writeTarget()
      .team.deleteMany({ where: { id, organizationId } });
    return count > 0;
  }

  private translate(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return teamNameTaken();
    }
    return err;
  }
}
