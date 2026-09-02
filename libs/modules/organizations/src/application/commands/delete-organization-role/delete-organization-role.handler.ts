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
    const outcome = await this.roles.deleteUnlessHeld(command.organizationId, command.role);

    switch (outcome) {
      case 'deleted':
        return;
      case 'in_use':
        throw roleInUse();
      case 'not_found':
        throw roleNotFound();
      default: {
        const unhandled: never = outcome;
        throw new Error(`Unhandled role deletion outcome: ${String(unhandled)}`);
      }
    }
  }
}
