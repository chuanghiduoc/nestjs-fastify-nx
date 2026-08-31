import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
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

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

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

    const rows = await this.prisma.readTarget().team.findMany({
      where,
      include: { _count: { select: { members: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    return { items: (hasMore ? rows.slice(0, limit) : rows).map(toEntity), hasMore };
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

  async update(team: Team): Promise<void> {
    try {
      await this.prisma
        .writeTarget()
        .team.update({ where: { id: team.id }, data: { name: team.name } });
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
