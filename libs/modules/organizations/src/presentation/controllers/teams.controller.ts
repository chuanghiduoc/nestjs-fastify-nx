import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { ListTeamsQuery } from '../../application/queries/list-teams/list-teams.query';
import { CreateTeamCommand } from '../../application/commands/create-team/create-team.command';
import { UpdateTeamCommand } from '../../application/commands/update-team/update-team.command';
import { DeleteTeamCommand } from '../../application/commands/delete-team/delete-team.command';
import type { TeamDto } from '../../application/dto/organization-role.dto';
import {
  CreateTeamDto,
  ListTeamsFilterDto,
  TeamResponseDto,
  UpdateTeamDto,
} from '../dto/organization-role.dto';

const TEAMS_PATH = '/api/v1/organizations/current/teams';

@ApiTags('organizations')
@Controller('organizations/current/teams')
@ApiCookieAuth('session')
export class TeamsController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.TEAM_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List teams in the active organization',
    description:
      'Cursor-paginated, newest first. `search` matches the team name case-insensitively. Each entry carries the number of members currently assigned to the team.',
  })
  @ApiPaginatedResponse(TeamResponseDto, { description: 'Cursor-paginated list of teams.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  async list(
    @CurrentUser() user: AuthenticatedSession,
    @Query() filter: ListTeamsFilterDto,
  ): Promise<ListResponseDto<TeamDto>> {
    const result = await this.queryBus.execute(
      new ListTeamsQuery(requireOrganizationId(user), filter.limit, {
        startingAfter: filter.startingAfter,
        search: filter.search,
      }),
    );

    return toCursorListResponse({
      url: TEAMS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }

  @Post()
  @RequirePermission(PERMISSIONS.TEAM_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a team in the active organization' })
  @ApiCreatedResponse({ type: TeamResponseDto, description: 'Team created.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true, conflict: true })
  create(@CurrentUser() user: AuthenticatedSession, @Body() dto: CreateTeamDto): Promise<TeamDto> {
    return this.commandBus.execute(new CreateTeamCommand(requireOrganizationId(user), dto.name));
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TEAM_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rename a team' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Team id (UUID v7).' })
  @ApiOkResponse({ type: TeamResponseDto, description: 'Team updated.' })
  @ApiCommonErrors({
    auth: true,
    forbidden: true,
    validation: true,
    notFound: true,
    conflict: true,
  })
  update(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamDto> {
    return this.commandBus.execute(
      new UpdateTeamCommand(requireOrganizationId(user), id, dto.name),
    );
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TEAM_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a team',
    description:
      'Team membership rows cascade with the team. Members keep their organization membership.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Team id (UUID v7).' })
  @ApiNoContentResponse({ description: 'Team deleted.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true })
  remove(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.commandBus.execute(new DeleteTeamCommand(requireOrganizationId(user), id));
  }
}
