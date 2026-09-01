import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import {
  CurrentUser,
  requireOrganizationId,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { GetCurrentOrganizationQuery } from '../../application/queries/get-current-organization/get-current-organization.query';
import type { OrganizationDto } from '../../application/dto/organization-role.dto';
import { OrganizationResponseDto } from '../dto/organization-role.dto';

@ApiTags('organizations')
@Controller('organizations')
@ApiCookieAuth('session')
export class OrganizationsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('current')
  @RequirePermission(PERMISSIONS.ORGANIZATION_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Read the session's active organization",
    description:
      'Returns the organization the current session is scoped to, with member, team and pending-invitation counts. Switching organizations is done through the Better Auth surface (`POST /api/auth/organization/set-active`).',
  })
  @ApiOkResponse({ type: OrganizationResponseDto, description: 'Active organization.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true })
  current(@CurrentUser() user: AuthenticatedSession): Promise<OrganizationDto> {
    return this.queryBus.execute(new GetCurrentOrganizationQuery(requireOrganizationId(user)));
  }
}
