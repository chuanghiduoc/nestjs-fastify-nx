import { Command } from '@nestjs/cqrs';
import type { OrganizationRoleDto } from '../../dto/organization-role.dto';

export interface CreateOrganizationRoleInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

export class CreateOrganizationRoleCommand extends Command<OrganizationRoleDto> {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly role: string;
  readonly permissions: readonly string[];

  constructor(input: CreateOrganizationRoleInput) {
    super();
    this.organizationId = input.organizationId;
    this.actorUserId = input.actorUserId;
    this.role = input.role;
    this.permissions = input.permissions;
  }
}
