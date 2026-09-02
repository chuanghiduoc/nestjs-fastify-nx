import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiCommonErrors, ListResponseDto, toListResponse } from '@nestjs-fastify-nx/contracts';
import {
  CurrentUser,
  requireOrganizationId,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { ListOrganizationRolesQuery } from '../../application/queries/list-organization-roles/list-organization-roles.query';
import { CreateOrganizationRoleCommand } from '../../application/commands/create-organization-role/create-organization-role.command';
import { UpdateOrganizationRoleCommand } from '../../application/commands/update-organization-role/update-organization-role.command';
import { DeleteOrganizationRoleCommand } from '../../application/commands/delete-organization-role/delete-organization-role.command';
import type { OrganizationRoleDto } from '../../application/dto/organization-role.dto';
import {
  CreateOrganizationRoleDto,
  OrganizationRoleResponseDto,
  UpdateOrganizationRoleDto,
} from '../dto/organization-role.dto';

const ROLES_PATH = '/api/v1/organizations/current/roles';

@ApiTags('organizations')
@Controller('organizations/current/roles')
@ApiCookieAuth('session')
export class OrganizationRolesController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.ROLE_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List roles available in the active organization',
    description:
      'Returns the built-in system roles followed by the roles this organization defined itself. System roles carry `system: true`, a null `id`, and cannot be updated or deleted. The list is small and bounded by the permission catalog, so it is not paginated.',
  })
  @ApiOkResponse({ type: ListResponseDto, description: 'System roles plus tenant-defined roles.' })
  @ApiCommonErrors({ auth: true, forbidden: true })
  async list(
    @CurrentUser() user: AuthenticatedSession,
  ): Promise<ListResponseDto<OrganizationRoleDto>> {
    const result = await this.queryBus.execute(
      new ListOrganizationRolesQuery(requireOrganizationId(user)),
    );

    return toListResponse({
      url: ROLES_PATH,
      items: result.data,
      page: 1,
      pageSize: result.data.length,
      total: result.data.length,
    });
  }

  @Post()
  @RequirePermission(PERMISSIONS.ROLE_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Define a custom role for the active organization',
    description:
      'Creates a tenant-defined role carrying a subset of the permission catalog. The role is written to the same `organization_roles` table Better Auth reads, so a member assigned this role resolves the identical permissions through both the REST guard and the auth surface.',
  })
  @ApiCreatedResponse({ type: OrganizationRoleResponseDto, description: 'Role created.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true, conflict: true })
  create(
    @CurrentUser() user: AuthenticatedSession,
    @Body() dto: CreateOrganizationRoleDto,
  ): Promise<OrganizationRoleDto> {
    return this.commandBus.execute(
      new CreateOrganizationRoleCommand({
        organizationId: requireOrganizationId(user),
        actorUserId: user.userId,
        role: dto.role,
        permissions: dto.permissions,
      }),
    );
  }

  @Patch(':role')
  @RequirePermission(PERMISSIONS.ROLE_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace the permissions of a custom role',
    description:
      'Replaces the permission set wholesale — permissions omitted from the payload are revoked. System roles are not editable and answer 404.',
  })
  @ApiParam({ name: 'role', description: 'Role name.', example: 'auditor' })
  @ApiOkResponse({ type: OrganizationRoleResponseDto, description: 'Role updated.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true, notFound: true })
  update(
    @CurrentUser() user: AuthenticatedSession,
    @Param('role') role: string,
    @Body() dto: UpdateOrganizationRoleDto,
  ): Promise<OrganizationRoleDto> {
    return this.commandBus.execute(
      new UpdateOrganizationRoleCommand({
        organizationId: requireOrganizationId(user),
        actorUserId: user.userId,
        role,
        permissions: dto.permissions,
      }),
    );
  }

  @Delete(':role')
  @RequirePermission(PERMISSIONS.ROLE_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a custom role',
    description:
      'Refuses with 409 while any member still holds the role — deleting it would strip their permissions with no audit trail. Reassign those members first.',
  })
  @ApiParam({ name: 'role', description: 'Role name.', example: 'auditor' })
  @ApiNoContentResponse({ description: 'Role deleted.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true, conflict: true })
  remove(@CurrentUser() user: AuthenticatedSession, @Param('role') role: string): Promise<void> {
    return this.commandBus.execute(
      new DeleteOrganizationRoleCommand(requireOrganizationId(user), role),
    );
  }
}
