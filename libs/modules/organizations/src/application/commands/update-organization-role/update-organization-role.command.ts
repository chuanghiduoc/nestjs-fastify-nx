import { Command } from '@nestjs/cqrs';
import type { OrganizationRoleDto } from '../../dto/organization-role.dto';

export interface UpdateOrganizationRoleInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

export class UpdateOrganizationRoleCommand extends Command<OrganizationRoleDto> {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly role: string;
  readonly permissions: readonly string[];

  constructor(input: UpdateOrganizationRoleInput) {
    super();
    this.organizationId = input.organizationId;
    this.actorUserId = input.actorUserId;
    this.role = input.role;
    this.permissions = input.permissions;
  }
}
