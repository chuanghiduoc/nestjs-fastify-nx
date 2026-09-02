import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AUTHORIZATION_PORT, type AuthorizationPort } from '@nestjs-fastify-nx/core';
import { ORGANIZATION_ROLE_REPOSITORY } from '../../../domain/ports/organization-role-repository.port';
import type { OrganizationRoleRepositoryPort } from '../../../domain/ports/organization-role-repository.port';
import { OrganizationRole } from '../../../domain/entities/organization-role.entity';
import type { OrganizationRoleDto } from '../../dto/organization-role.dto';
import { roleAlreadyExists } from '../../organization-errors';
import { CreateOrganizationRoleCommand } from './create-organization-role.command';

@CommandHandler(CreateOrganizationRoleCommand)
export class CreateOrganizationRoleHandler implements ICommandHandler<
  CreateOrganizationRoleCommand,
  OrganizationRoleDto
> {
  constructor(
    @Inject(ORGANIZATION_ROLE_REPOSITORY) private readonly roles: OrganizationRoleRepositoryPort,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
  ) {}

  async execute(command: CreateOrganizationRoleCommand): Promise<OrganizationRoleDto> {
    const grantedToActor = await this.authorization.permissionsFor({
      type: 'user',
      userId: command.actorUserId,
      organizationId: command.organizationId,
    });

    const role = OrganizationRole.create({
      organizationId: command.organizationId,
      role: command.role,
      permissions: command.permissions,
      grantedToActor,
    });

    if (await this.roles.findByName(command.organizationId, role.role)) {
      throw roleAlreadyExists();
    }

    await this.roles.create(role);

    return {
      id: role.id,
      role: role.role,
      system: false,
      permissions: role.permissions,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
