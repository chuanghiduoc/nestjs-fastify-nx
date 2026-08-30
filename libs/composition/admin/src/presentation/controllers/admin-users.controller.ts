import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import {
  ListUsersCursorFilterDto,
  ListUsersCursorQuery,
  UserListItemResponseDto,
  type UserListItemDto,
} from '@nestjs-fastify-nx/modules-users';

const ADMIN_USERS_PATH = '/api/v1/admin/users';

// Organization-scoped, not platform-scoped: `@Roles('ADMIN')` gates on `User.role`, which is the
// provider's own staff axis and would lock out an organization owner (whose platform role is USER)
// while letting provider staff read another tenant's members.
@ApiTags('admin')
@Controller('admin/users')
@ApiCookieAuth('session')
export class AdminUsersController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @RequirePermission(PERMISSIONS.MEMBER_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List members of the active organization',
    description:
      "Returns a Stripe-style cursor-paginated list envelope of the users who belong to the caller's active organization. Pass `startingAfter` from the previous response to fetch the next page. Filterable by `role`, `status`, and `search` (case-insensitive across `email` and `name`). Requires the `member:read` permission.",
  })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  @ApiPaginatedResponse(UserListItemResponseDto, {
    description: 'Cursor-paginated list of organization members.',
  })
  async list(
    @CurrentUser() user: AuthenticatedSession,
    @Query() filter: ListUsersCursorFilterDto,
  ): Promise<ListResponseDto<UserListItemDto>> {
    const result = await this.queryBus.execute(
      new ListUsersCursorQuery(requireOrganizationId(user), filter.limit, {
        startingAfter: filter.startingAfter,
        role: filter.role,
        status: filter.status,
        search: filter.search,
      }),
    );

    return toCursorListResponse({
      url: ADMIN_USERS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }
}
