import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
  ListResponseDto,
  toCursorListResponse,
} from '@nestjs-fastify-nx/contracts';
import { BetterAuthGuard, Roles, RolesGuard } from '@nestjs-fastify-nx/infra-auth';
import {
  ListUsersCursorFilterDto,
  ListUsersCursorHandler,
  ListUsersCursorQuery,
  UserListItemResponseDto,
  type UserListItemDto,
} from '@nestjs-fastify-nx/modules-users';

const ADMIN_USERS_PATH = '/api/v1/admin/users';

@ApiTags('admin')
@Controller('admin/users')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiCookieAuth('session')
export class AdminUsersController {
  constructor(private readonly listUsersCursorHandler: ListUsersCursorHandler) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List users (admin)',
    description:
      'Returns a Stripe-style cursor-paginated list envelope. Pass `startingAfter` from the previous response to fetch the next page. Filterable by `role`, `status`, and `search` (case-insensitive across `email` and `name`). Requires the `ADMIN` role.',
  })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  @ApiPaginatedResponse(UserListItemResponseDto, { description: 'Cursor-paginated list of users.' })
  async list(@Query() filter: ListUsersCursorFilterDto): Promise<ListResponseDto<UserListItemDto>> {
    const result = await this.listUsersCursorHandler.execute(
      new ListUsersCursorQuery(
        filter.limit,
        filter.startingAfter,
        filter.role,
        filter.status,
        filter.search,
      ),
    );

    return toCursorListResponse({
      url: ADMIN_USERS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }
}
