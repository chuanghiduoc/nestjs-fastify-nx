import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import { Term, type TermType } from '../../domain/entities/term.entity';
import type {
  TermAcceptanceRecord,
  TermRepositoryPort,
} from '../../domain/ports/term-repository.port';
import { termVersionTaken } from '../../application/term-errors';

type TermRow = {
  id: string;
  type: string;
  version: string;
  content: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toEntity(row: TermRow): Term {
  return Term.reconstitute({ ...row, type: row.type as TermType });
}

@Injectable()
export class PrismaTermRepository implements TermRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findPublished(): Promise<Term[]> {
    const rows = await this.prisma.readTarget().term.findMany({
      where: { publishedAt: { not: null } },
      orderBy: [{ type: 'asc' }, { publishedAt: 'desc' }],
    });
    return rows.map(toEntity);
  }

  async findLatestPublished(type: TermType): Promise<Term | null> {
    const row = await this.prisma.readTarget().term.findFirst({
      where: { type, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
    });
    return row ? toEntity(row) : null;
  }

  async findById(id: string): Promise<Term | null> {
    const row = await this.prisma.writeTarget().term.findUnique({ where: { id } });
    return row ? toEntity(row) : null;
  }

  async create(term: Term): Promise<void> {
    try {
      await this.prisma.writeTarget().term.create({
        data: {
          id: term.id,
          type: term.type,
          version: term.version,
          content: term.content,
          publishedAt: term.publishedAt,
          createdAt: term.createdAt,
          updatedAt: term.updatedAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw termVersionTaken();
      }
      throw err;
    }
  }

  // Compare-and-set on the unpublished row so two concurrent publishes cannot move the date that
  // records when the document became binding.
  async publish(id: string, publishedAt: Date): Promise<boolean> {
    const { count } = await this.prisma
      .writeTarget()
      .term.updateMany({ where: { id, publishedAt: null }, data: { publishedAt } });
    return count > 0;
  }

  async recordAcceptance(input: {
    termId: string;
    userId: string;
    acceptedAt: Date;
    ipAddress: string | null;
  }): Promise<void> {
    await this.prisma.writeTarget().termAcceptance.upsert({
      where: { termId_userId: { termId: input.termId, userId: input.userId } },
      create: {
        termId: input.termId,
        userId: input.userId,
        acceptedAt: input.acceptedAt,
        ipAddress: input.ipAddress,
      },
      // Acceptance is a point in time that already happened; re-submitting must not move it.
      update: {},
    });
  }

  async findAcceptances(userId: string): Promise<TermAcceptanceRecord[]> {
    const rows = await this.prisma.readTarget().termAcceptance.findMany({
      where: { userId },
      include: { term: { select: { type: true, version: true } } },
      orderBy: { acceptedAt: 'desc' },
    });

    return rows.map((row) => ({
      termId: row.termId,
      type: row.term.type as TermType,
      version: row.term.version,
      acceptedAt: row.acceptedAt,
    }));
  }
}
