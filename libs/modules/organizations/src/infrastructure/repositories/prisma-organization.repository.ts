import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type {
  OrganizationRepositoryPort,
  OrganizationSummary,
} from '../../domain/ports/organization-repository.port';
import { pendingInvitationWhere } from './pending-invitation.where';

@Injectable()
export class PrismaOrganizationRepository implements OrganizationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findSummary(organizationId: string): Promise<OrganizationSummary | null> {
    const row = await this.prisma.readTarget().organization.findUnique({
      where: { id: organizationId },
      include: {
        _count: {
          select: {
            members: true,
            teams: true,
            invitations: { where: pendingInvitationWhere(new Date()) },
          },
        },
      },
    });
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      createdAt: row.createdAt,
      memberCount: row._count.members,
      teamCount: row._count.teams,
      pendingInvitationCount: row._count.invitations,
    };
  }
}
