import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
  ListResponseDto,
  toListResponse,
} from '@nestjs-fastify-nx/contracts';
import { BetterAuthGuard, Roles, RolesGuard } from '@nestjs-fastify-nx/infra-auth';
import {
  ListUsersFilterDto,
  ListUsersHandler,
  ListUsersQuery,
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
  constructor(private readonly listUsersHandler: ListUsersHandler) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List users (admin)',
    description:
      'Returns a Stripe-style list envelope with offset pagination. Filterable by `role`, `status`, and `search` (case-insensitive across `email` and `name`). Requires the `ADMIN` role.',
  })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  @ApiPaginatedResponse(UserListItemResponseDto, { description: 'Paginated list of users.' })
  async list(@Query() filter: ListUsersFilterDto): Promise<ListResponseDto<UserListItemDto>> {
    const page = await this.listUsersHandler.execute(
      new ListUsersQuery(filter.page, filter.pageSize, filter.role, filter.status, filter.search),
    );

    return toListResponse({
      url: ADMIN_USERS_PATH,
      items: page.data,
      page: page.meta.page,
      pageSize: page.meta.pageSize,
      total: page.meta.total,
    });
  }
}
