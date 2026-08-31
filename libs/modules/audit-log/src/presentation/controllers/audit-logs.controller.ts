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
  ListAuditLogsCursorQuery,
  type ListAuditLogsCursorResult,
} from '../../application/queries/list-audit-logs-cursor/list-audit-logs-cursor.query';
import type { AuditLogListItemDto } from '../../application/dto/audit-log-list-item.dto';
import { ListAuditLogsCursorFilterDto } from '../dto/list-audit-logs-cursor-filter.dto';
import { AuditLogResponseDto } from '../dto/audit-log-response.dto';

const AUDIT_LOGS_PATH = '/api/v1/audit-logs';

@ApiTags('audit-logs')
@Controller('audit-logs')
@ApiCookieAuth('session')
export class AuditLogsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_LOG_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List audit entries for the active organization',
    description:
      "Returns a Stripe-style cursor-paginated list of audit entries recorded for the caller's active organization, newest first. Filterable by `action`, `resource`, `userId` and an inclusive `occurredFrom`/`occurredUntil` window. `totalCount` is deliberately omitted — `audit_logs` is a growth table where COUNT would be a hot path. Requires the `audit_log:read` permission.",
  })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  @ApiPaginatedResponse(AuditLogResponseDto, {
    description: 'Cursor-paginated list of audit entries.',
  })
  async list(
    @CurrentUser() user: AuthenticatedSession,
    @Query() filter: ListAuditLogsCursorFilterDto,
  ): Promise<ListResponseDto<AuditLogListItemDto>> {
    const result: ListAuditLogsCursorResult = await this.queryBus.execute(
      new ListAuditLogsCursorQuery(requireOrganizationId(user), filter.limit, {
        startingAfter: filter.startingAfter,
        action: filter.action,
        resource: filter.resource,
        userId: filter.userId,
        occurredFrom: filter.occurredFrom,
        occurredUntil: filter.occurredUntil,
      }),
    );

    return toCursorListResponse({
      url: AUDIT_LOGS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }
}
