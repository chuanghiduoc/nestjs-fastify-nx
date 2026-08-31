import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { Prisma } from '@nestjs-fastify-nx/infra-database';
import type { Permission } from '@nestjs-fastify-nx/shared';
import { ApiKey } from '../../domain/entities/api-key.entity';
import type {
  ApiKeyRepositoryPort,
  FindApiKeysCursorOptions,
  FindApiKeysCursorResult,
} from '../../domain/ports/api-key-repository.port';

type ApiKeyRow = {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  createdById: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toEntity(row: ApiKeyRow): ApiKey {
  return ApiKey.reconstitute({ ...row, scopes: row.scopes as Permission[] });
}

@Injectable()
export class PrismaApiKeyRepository implements ApiKeyRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAllCursor(options: FindApiKeysCursorOptions): Promise<FindApiKeysCursorResult> {
    const { organizationId, startingAfter, limit, includeRevoked } = options;

    const where: Prisma.ApiKeyWhereInput = { organizationId };
    if (!includeRevoked) where.revokedAt = null;
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

    const rows = await this.prisma.readTarget().apiKey.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    return { items: (hasMore ? rows.slice(0, limit) : rows).map(toEntity), hasMore };
  }

  async create(apiKey: ApiKey): Promise<void> {
    await this.prisma.writeTarget().apiKey.create({
      data: {
        id: apiKey.id,
        organizationId: apiKey.organizationId,
        name: apiKey.name,
        prefix: apiKey.prefix,
        keyHash: apiKey.keyHash,
        scopes: [...apiKey.scopes],
        createdById: apiKey.createdById,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
      },
    });
  }

  async revoke(organizationId: string, id: string, revokedAt: Date): Promise<boolean> {
    const { count } = await this.prisma.writeTarget().apiKey.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { revokedAt },
    });
    return count > 0;
  }

  async exists(organizationId: string, id: string): Promise<boolean> {
    const row = await this.prisma
      .writeTarget()
      .apiKey.findFirst({ where: { id, organizationId }, select: { id: true } });
    return row !== null;
  }
}
