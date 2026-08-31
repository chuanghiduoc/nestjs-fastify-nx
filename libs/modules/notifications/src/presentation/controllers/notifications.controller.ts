import {
  Controller,
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
import {
  CurrentUser,
  requireOrganizationId,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { ListNotificationsQuery } from '../../application/queries/list-notifications/list-notifications.query';
import { CountUnreadNotificationsQuery } from '../../application/queries/count-unread-notifications/count-unread-notifications.query';
import { MarkNotificationReadCommand } from '../../application/commands/mark-notification-read/mark-notification-read.command';
import {
  MarkAllNotificationsReadCommand,
  type MarkAllNotificationsReadResult,
} from '../../application/commands/mark-all-notifications-read/mark-all-notifications-read.command';
import type { NotificationDto, UnreadCountDto } from '../../application/dto/notification.dto';
import {
  ListNotificationsFilterDto,
  MarkAllReadResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from '../dto/notification.dto';

const NOTIFICATIONS_PATH = '/api/v1/notifications';

@ApiTags('notifications')
@Controller('notifications')
@ApiCookieAuth('session')
export class NotificationsController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.NOTIFICATION_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the caller’s notifications',
    description:
      'Cursor-paginated, newest first, scoped to the caller within their active organization. The permission gates the feature; the rows are always the caller’s own — a member never sees another member’s notifications.',
  })
  @ApiPaginatedResponse(NotificationResponseDto, {
    description: 'Cursor-paginated list of notifications.',
  })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  async list(
    @CurrentUser() user: AuthenticatedSession,
    @Query() filter: ListNotificationsFilterDto,
  ): Promise<ListResponseDto<NotificationDto>> {
    const result = await this.queryBus.execute(
      new ListNotificationsQuery(requireOrganizationId(user), user.userId, filter.limit, {
        startingAfter: filter.startingAfter,
        unreadOnly: filter.unreadOnly,
      }),
    );

    return toCursorListResponse({
      url: NOTIFICATIONS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }

  @Get('unread-count')
  @RequirePermission(PERMISSIONS.NOTIFICATION_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Count the caller’s unread notifications' })
  @ApiOkResponse({ type: UnreadCountResponseDto, description: 'Unread count.' })
  @ApiCommonErrors({ auth: true, forbidden: true })
  unreadCount(@CurrentUser() user: AuthenticatedSession): Promise<UnreadCountDto> {
    return this.queryBus.execute(
      new CountUnreadNotificationsQuery(requireOrganizationId(user), user.userId),
    );
  }

  @Post(':id/read')
  @RequirePermission(PERMISSIONS.NOTIFICATION_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark one notification as read',
    description: 'Idempotent — repeating the call on an already-read notification is a no-op.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Notification id (UUID v7).' })
  @ApiNoContentResponse({ description: 'Notification marked read.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true })
  markRead(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.commandBus.execute(
      new MarkNotificationReadCommand(requireOrganizationId(user), user.userId, id),
    );
  }

  @Post('read-all')
  @RequirePermission(PERMISSIONS.NOTIFICATION_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every unread notification as read' })
  @ApiOkResponse({ type: MarkAllReadResponseDto, description: 'Number of rows marked.' })
  @ApiCommonErrors({ auth: true, forbidden: true })
  markAllRead(@CurrentUser() user: AuthenticatedSession): Promise<MarkAllNotificationsReadResult> {
    return this.commandBus.execute(
      new MarkAllNotificationsReadCommand(requireOrganizationId(user), user.userId),
    );
  }
}
