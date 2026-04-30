import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Page } from '@nestjs-fastify-nx/shared';
import { BetterAuthGuard, Roles, RolesGuard } from '@nestjs-fastify-nx/infra-auth';
import {
  ListUsersFilterDto,
  ListUsersHandler,
  ListUsersQuery,
  type UserListItemDto,
} from '@nestjs-fastify-nx/modules-users';

@ApiTags('admin')
@Controller('admin/users')
@UseGuards(BetterAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiCookieAuth('session')
export class AdminUsersController {
  constructor(private readonly listUsersHandler: ListUsersHandler) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin only: list users with role/status/search filters' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  @ApiResponse({ status: 403, description: 'Forbidden — requires ADMIN role' })
  list(@Query() filter: ListUsersFilterDto): Promise<Page<UserListItemDto>> {
    return this.listUsersHandler.execute(
      new ListUsersQuery(filter.page, filter.limit, filter.role, filter.status, filter.search),
    );
  }
}
