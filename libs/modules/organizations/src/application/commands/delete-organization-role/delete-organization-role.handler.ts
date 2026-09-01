import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ORGANIZATION_ROLE_REPOSITORY } from '../../../domain/ports/organization-role-repository.port';
import type { OrganizationRoleRepositoryPort } from '../../../domain/ports/organization-role-repository.port';
import { roleInUse, roleNotFound } from '../../organization-errors';
import { DeleteOrganizationRoleCommand } from './delete-organization-role.command';

@CommandHandler(DeleteOrganizationRoleCommand)
export class DeleteOrganizationRoleHandler implements ICommandHandler<
  DeleteOrganizationRoleCommand,
  void
> {
  constructor(
    @Inject(ORGANIZATION_ROLE_REPOSITORY) private readonly roles: OrganizationRoleRepositoryPort,
  ) {}

  async execute(command: DeleteOrganizationRoleCommand): Promise<void> {
    const holders = await this.roles.countMembersHolding(command.organizationId, command.role);
    if (holders > 0) throw roleInUse();

    const deleted = await this.roles.delete(command.organizationId, command.role);
    if (!deleted) throw roleNotFound();
  }
}
