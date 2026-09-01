import { Query } from '@nestjs/cqrs';
import type { OrganizationDto } from '../../dto/organization-role.dto';

export class GetCurrentOrganizationQuery extends Query<OrganizationDto> {
  constructor(readonly organizationId: string) {
    super();
  }
}
