import { Injectable } from '@nestjs/common';
import { PrismaService, type TransactionClient } from '@nestjs-fastify-nx/infra-database';
import { SYSTEM_ROLES } from '@nestjs-fastify-nx/shared';
import type { PersonalOrganizationRepositoryPort } from '../../domain/ports/personal-organization-repository.port';

@Injectable()
export class PrismaPersonalOrganizationRepository implements PersonalOrganizationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findFirstOrganizationId(userId: string): Promise<string | null> {
    const membership = await this.prisma.writeTarget().member.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });
    return membership?.organizationId ?? null;
  }

  findUserIdentity(userId: string): Promise<{ name: string; email: string }> {
    return this.prisma.writeTarget().user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });
  }

  async createIfAbsent(userId: string, name: string, slug: string): Promise<string> {
    const create = async (tx: TransactionClient): Promise<string> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const existing = await tx.member.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { organizationId: true },
      });
      if (existing) return existing.organizationId;

      const organization = await tx.organization.create({
        data: { name, slug },
        select: { id: true },
      });
      await tx.member.create({
        data: { organizationId: organization.id, userId, role: SYSTEM_ROLES.OWNER },
        select: { id: true },
      });
      return organization.id;
    };

    const transaction = this.prisma.currentTransaction;
    return transaction ? create(transaction) : this.prisma.db.$transaction(create);
  }
}
