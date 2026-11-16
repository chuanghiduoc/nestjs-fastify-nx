import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepositoryPort,
} from '../../domain/ports/organization-repository.port';
import type { OrganizationDto } from '../dto/organization-role-application.dto';
import { organizationNotFound } from '../organization-errors';

export class GetCurrentOrganizationQuery extends Query<OrganizationDto> {
  constructor(readonly organizationId: string) {
    super();
  }
}

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
    return summary;
  }
}
