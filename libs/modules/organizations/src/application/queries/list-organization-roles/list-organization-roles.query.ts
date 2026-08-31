import { Query } from '@nestjs/cqrs';
import type { OrganizationRoleDto } from '../../dto/organization-role.dto';

export interface ListOrganizationRolesResult {
  data: OrganizationRoleDto[];
}

export class ListOrganizationRolesQuery extends Query<ListOrganizationRolesResult> {
  constructor(readonly organizationId: string) {
    super();
  }
}
