import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import { FeatureFlag } from '../../domain/entities/feature-flag.entity';
import type {
  FeatureFlagRepositoryPort,
  FindFeatureFlagsCursorOptions,
  FindFeatureFlagsCursorResult,
} from '../../domain/ports/feature-flag-repository.port';
import { featureFlagKeyTaken } from '../../application/feature-flag-errors';

type FeatureFlagRow = {
  id: string;
  organizationId: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  createdAt: Date;
  updatedAt: Date;
};

function toEntity(row: FeatureFlagRow): FeatureFlag {
  return FeatureFlag.reconstitute(row);
}

@Injectable()
export class PrismaFeatureFlagRepository implements FeatureFlagRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAllCursor(
    options: FindFeatureFlagsCursorOptions,
  ): Promise<FindFeatureFlagsCursorResult> {
    const { organizationId, startingAfter, limit } = options;

    const where: Prisma.FeatureFlagWhereInput = { organizationId };
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

    const rows = await this.prisma.readTarget().featureFlag.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    return { items: (hasMore ? rows.slice(0, limit) : rows).map(toEntity), hasMore };
  }

  async findAll(organizationId: string): Promise<FeatureFlag[]> {
    const rows = await this.prisma
      .readTarget()
      .featureFlag.findMany({ where: { organizationId }, orderBy: { key: 'asc' } });
    return rows.map(toEntity);
  }

  async findById(organizationId: string, id: string): Promise<FeatureFlag | null> {
    const row = await this.prisma
      .writeTarget()
      .featureFlag.findFirst({ where: { id, organizationId } });
    return row ? toEntity(row) : null;
  }

  async create(flag: FeatureFlag): Promise<void> {
    try {
      await this.prisma.writeTarget().featureFlag.create({
        data: {
          id: flag.id,
          organizationId: flag.organizationId,
          key: flag.key,
          description: flag.description,
          enabled: flag.enabled,
          rolloutPercentage: flag.rolloutPercentage,
          createdAt: flag.createdAt,
          updatedAt: flag.updatedAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw featureFlagKeyTaken();
      }
      throw err;
    }
  }

  async update(flag: FeatureFlag): Promise<void> {
    await this.prisma.writeTarget().featureFlag.update({
      where: { id: flag.id },
      data: {
        description: flag.description,
        enabled: flag.enabled,
        rolloutPercentage: flag.rolloutPercentage,
      },
    });
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma
      .writeTarget()
      .featureFlag.deleteMany({ where: { id, organizationId } });
    return count > 0;
  }
}
