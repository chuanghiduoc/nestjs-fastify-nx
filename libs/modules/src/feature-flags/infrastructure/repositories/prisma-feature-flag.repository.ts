import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import { Prisma } from '@nestjs-fastify-nx/infra/database';
import { keysetAfter, takePage } from '@nestjs-fastify-nx/shared';
import { FeatureFlag } from '../../domain/entities/feature-flag.entity';
import type {
  FeatureFlagRepositoryPort,
  FeatureFlagUpdateOutcome,
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
  version: number;
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
    if (startingAfter) where.AND = [keysetAfter(startingAfter)];

    const rows = await this.prisma.runTenantScoped(
      (client) =>
        client.featureFlag.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        }),
      { readOnly: true },
    );

    const { items, hasMore } = takePage(rows, limit);
    return { items: items.map(toEntity), hasMore };
  }

  async findAll(organizationId: string): Promise<FeatureFlag[]> {
    const rows = await this.prisma.runTenantScoped(
      (client) =>
        client.featureFlag.findMany({ where: { organizationId }, orderBy: { key: 'asc' } }),
      { readOnly: false },
    );
    return rows.map(toEntity);
  }

  async findById(organizationId: string, id: string): Promise<FeatureFlag | null> {
    const row = await this.prisma.runTenantScoped(
      (client) => client.featureFlag.findFirst({ where: { id, organizationId } }),
      { readOnly: false },
    );
    return row ? toEntity(row) : null;
  }

  async create(flag: FeatureFlag): Promise<void> {
    try {
      await this.prisma.runTenantScoped(
        (client) =>
          client.featureFlag.create({
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
          }),
        { readOnly: false },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw featureFlagKeyTaken();
      }
      throw err;
    }
  }

  update(flag: FeatureFlag): Promise<FeatureFlagUpdateOutcome> {
    return this.prisma.runTenantScoped(
      async (client): Promise<FeatureFlagUpdateOutcome> => {
        const { count } = await client.featureFlag.updateMany({
          where: { id: flag.id, organizationId: flag.organizationId, version: flag.version },
          data: {
            description: flag.description,
            enabled: flag.enabled,
            rolloutPercentage: flag.rolloutPercentage,
            updatedAt: flag.updatedAt,
            version: { increment: 1 },
          },
        });
        if (count > 0) return 'updated';

        const current = await client.featureFlag.findFirst({
          where: { id: flag.id, organizationId: flag.organizationId },
          select: { id: true },
        });
        return current ? 'stale' : 'not_found';
      },
      { readOnly: false },
    );
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.runTenantScoped(
      (client) => client.featureFlag.deleteMany({ where: { id, organizationId } }),
      { readOnly: false },
    );
    return count > 0;
  }
}
