import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AUTHORIZATION_PORT, type AuthorizationPort } from '@nestjs-fastify-nx/core';
import { ORGANIZATION_ROLE_REPOSITORY } from '../../../domain/ports/organization-role-repository.port';
import type { OrganizationRoleRepositoryPort } from '../../../domain/ports/organization-role-repository.port';
import type { OrganizationRoleDto } from '../../dto/organization-role.dto';
import { roleNotFound } from '../../organization-errors';
import { UpdateOrganizationRoleCommand } from './update-organization-role.command';

@CommandHandler(UpdateOrganizationRoleCommand)
export class UpdateOrganizationRoleHandler implements ICommandHandler<
  UpdateOrganizationRoleCommand,
  OrganizationRoleDto
> {
  constructor(
    @Inject(ORGANIZATION_ROLE_REPOSITORY) private readonly roles: OrganizationRoleRepositoryPort,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
  ) {}

  async execute(command: UpdateOrganizationRoleCommand): Promise<OrganizationRoleDto> {
    const existing = await this.roles.findByName(command.organizationId, command.role);
    if (!existing) throw roleNotFound();

    const grantedToActor = await this.authorization.permissionsFor({
      type: 'user',
      userId: command.actorUserId,
      organizationId: command.organizationId,
    });

    const updated = existing.withPermissions(command.permissions, grantedToActor);
    await this.roles.update(updated);

    return {
      id: updated.id,
      role: updated.role,
      system: false,
      permissions: updated.permissions,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
