import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiCookieAuth,
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
import { CurrentUser, type AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { ListMySessionsQuery } from '../../application/queries/list-my-sessions/list-my-sessions.query';
import { RevokeSessionCommand } from '../../application/commands/revoke-session/revoke-session.command';
import { RevokeOtherSessionsCommand } from '../../application/commands/revoke-other-sessions/revoke-other-sessions.command';
import type { RevokedSessionsDto, SessionDto } from '../../application/dto/session.dto';
import {
  ListSessionsFilterDto,
  RevokedSessionsResponseDto,
  SessionResponseDto,
} from '../dto/session.dto';

const SESSIONS_PATH = '/api/v1/sessions';

@ApiTags('sessions')
@Controller('sessions')
@ApiCookieAuth('session')
export class SessionsController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.SESSION_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the caller’s sign-in sessions',
    description:
      'Cursor-paginated, newest first, always scoped to the caller. Each entry carries the IP and user agent captured at sign-in so a person can recognise their own devices; the session token itself is never returned.',
  })
  @ApiPaginatedResponse(SessionResponseDto, { description: 'Cursor-paginated list of sessions.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  async list(
    @CurrentUser() user: AuthenticatedSession,
    @Query() filter: ListSessionsFilterDto,
  ): Promise<ListResponseDto<SessionDto>> {
    const result = await this.queryBus.execute(
      new ListMySessionsQuery(user.userId, user.sessionId, filter.limit, {
        startingAfter: filter.startingAfter,
        activeOnly: filter.activeOnly,
      }),
    );

    return toCursorListResponse({
      url: SESSIONS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.SESSION_REVOKE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out one session',
    description:
      'Deletes the session row, so the device holding it is signed out on its next request. Passing the current session id signs the caller out here as well.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Session id (UUID v7).' })
  @ApiNoContentResponse({ description: 'Session revoked.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true })
  revoke(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.commandBus.execute(new RevokeSessionCommand(user.userId, id));
  }

  @Post('revoke-others')
  @RequirePermission(PERMISSIONS.SESSION_REVOKE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out every other session',
    description:
      'The classic "sign out everywhere else" action after a password change. The session making the request survives.',
  })
  @ApiOkResponse({ type: RevokedSessionsResponseDto, description: 'How many were revoked.' })
  @ApiCommonErrors({ auth: true, forbidden: true })
  revokeOthers(@CurrentUser() user: AuthenticatedSession): Promise<RevokedSessionsDto> {
    return this.commandBus.execute(new RevokeOtherSessionsCommand(user.userId, user.sessionId));
  }
}
