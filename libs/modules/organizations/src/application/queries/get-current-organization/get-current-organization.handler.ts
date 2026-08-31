import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ORGANIZATION_REPOSITORY } from '../../../domain/ports/organization-repository.port';
import type { OrganizationRepositoryPort } from '../../../domain/ports/organization-repository.port';
import type { OrganizationDto } from '../../dto/organization-role.dto';
import { organizationNotFound } from '../../organization-errors';
import { GetCurrentOrganizationQuery } from './get-current-organization.query';

@QueryHandler(GetCurrentOrganizationQuery)
export class GetCurrentOrganizationHandler implements IQueryHandler<
  GetCurrentOrganizationQuery,
  OrganizationDto
> {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepositoryPort,
  ) {}

  async execute(query: GetCurrentOrganizationQuery): Promise<OrganizationDto> {
    const summary = await this.organizations.findSummary(query.organizationId);
    if (!summary) throw organizationNotFound();

    return {
      id: summary.id,
      name: summary.name,
      slug: summary.slug,
      logo: summary.logo,
      memberCount: summary.memberCount,
      teamCount: summary.teamCount,
      pendingInvitationCount: summary.pendingInvitationCount,
      createdAt: summary.createdAt,
    };
  }
}
