import { Command } from '@nestjs/cqrs';
import type { OrganizationRoleDto } from '../../dto/organization-role.dto';

export class CreateOrganizationRoleCommand extends Command<OrganizationRoleDto> {
  constructor(
    readonly organizationId: string,
    readonly role: string,
    readonly permissions: readonly string[],
  ) {
    super();
  }
}
