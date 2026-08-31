import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS, type SystemRole } from '@nestjs-fastify-nx/shared';
import { ORGANIZATION_ROLE_REPOSITORY } from '../../../domain/ports/organization-role-repository.port';
import type { OrganizationRoleRepositoryPort } from '../../../domain/ports/organization-role-repository.port';
import type { OrganizationRoleDto } from '../../dto/organization-role.dto';
import {
  ListOrganizationRolesQuery,
  type ListOrganizationRolesResult,
} from './list-organization-roles.query';

@QueryHandler(ListOrganizationRolesQuery)
export class ListOrganizationRolesHandler implements IQueryHandler<
  ListOrganizationRolesQuery,
  ListOrganizationRolesResult
> {
  constructor(
    @Inject(ORGANIZATION_ROLE_REPOSITORY) private readonly roles: OrganizationRoleRepositoryPort,
  ) {}

  async execute(query: ListOrganizationRolesQuery): Promise<ListOrganizationRolesResult> {
    const custom = await this.roles.findAll(query.organizationId);

    const systemRoles: OrganizationRoleDto[] = Object.values(SYSTEM_ROLES).map(
      (role: SystemRole) => ({
        id: null,
        role,
        system: true,
        permissions: SYSTEM_ROLE_PERMISSIONS[role],
        createdAt: null,
        updatedAt: null,
      }),
    );

    const customRoles: OrganizationRoleDto[] = custom.map((entity) => ({
      id: entity.id,
      role: entity.role,
      system: false,
      permissions: entity.permissions,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    }));

    return { data: [...systemRoles, ...customRoles] };
  }
}
