import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
  ListResponseDto,
  toCursorListResponse,
} from '@nestjs-fastify-nx/contracts';
import {
  CurrentUser,
  requireOrganizationId,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { ListInvitationsQuery } from '../../application/queries/list-invitations/list-invitations.query';
import { CancelInvitationCommand } from '../../application/commands/cancel-invitation/cancel-invitation.command';
import type { InvitationDto } from '../../application/dto/organization-role.dto';
import { InvitationResponseDto, ListInvitationsFilterDto } from '../dto/organization-role.dto';

const INVITATIONS_PATH = '/api/v1/organizations/current/invitations';

@ApiTags('organizations')
@Controller('organizations/current/invitations')
@ApiCookieAuth('session')
export class InvitationsController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.INVITATION_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List invitations issued by the active organization',
    description:
      'Cursor-paginated, newest first. Invitations are created through the Better Auth organization surface (`POST /api/auth/organization/invite-member`); this endpoint exposes them under the same list envelope and permission model as the rest of the API.',
  })
  @ApiPaginatedResponse(InvitationResponseDto, {
    description: 'Cursor-paginated list of invitations.',
  })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  async list(
    @CurrentUser() user: AuthenticatedSession,
    @Query() filter: ListInvitationsFilterDto,
  ): Promise<ListResponseDto<InvitationDto>> {
    const result = await this.queryBus.execute(
      new ListInvitationsQuery(requireOrganizationId(user), filter.limit, {
        startingAfter: filter.startingAfter,
        status: filter.status,
        email: filter.email,
      }),
    );

    return toCursorListResponse({
      url: INVITATIONS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.INVITATION_CANCEL)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancel a pending invitation',
    description:
      'Moves a `pending` invitation to `canceled`. An invitation that was already accepted, rejected or canceled answers 409 — send a fresh invitation instead.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Invitation id (UUID v7).' })
  @ApiNoContentResponse({ description: 'Invitation canceled.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true, conflict: true })
  cancel(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.commandBus.execute(new CancelInvitationCommand(requireOrganizationId(user), id));
  }
}
