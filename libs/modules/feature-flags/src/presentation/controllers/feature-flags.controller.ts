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
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
  CursorPaginationDto,
  ListResponseDto,
  toCursorListResponse,
} from '@nestjs-fastify-nx/contracts';
import {
  AllowApiKey,
  CurrentApiKey,
  CurrentUser,
  resolveOrganizationId,
  type AuthenticatedApiKey,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { ListFeatureFlagsQuery } from '../../application/queries/list-feature-flags/list-feature-flags.query';
import { EvaluateFeatureFlagsQuery } from '../../application/queries/evaluate-feature-flags/evaluate-feature-flags.query';
import { CreateFeatureFlagCommand } from '../../application/commands/create-feature-flag/create-feature-flag.command';
import { UpdateFeatureFlagCommand } from '../../application/commands/update-feature-flag/update-feature-flag.command';
import { DeleteFeatureFlagCommand } from '../../application/commands/delete-feature-flag/delete-feature-flag.command';
import type { EvaluatedFlagsDto, FeatureFlagDto } from '../../application/dto/feature-flag.dto';
import {
  CreateFeatureFlagDto,
  EvaluatedFlagsResponseDto,
  FeatureFlagResponseDto,
  UpdateFeatureFlagDto,
} from '../dto/feature-flag.dto';

const FEATURE_FLAGS_PATH = '/api/v1/feature-flags';

@ApiTags('feature-flags')
@Controller('feature-flags')
@ApiCookieAuth('session')
export class FeatureFlagsController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.FEATURE_FLAG_READ)
  @AllowApiKey()
  @ApiSecurity('apiKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List feature flags of the active organization',
    description:
      'Cursor-paginated, newest first. Returns the flag definitions (master switch plus rollout share), not their resolution for a given subject — use `GET /feature-flags/evaluate` for that.',
  })
  @ApiPaginatedResponse(FeatureFlagResponseDto, {
    description: 'Cursor-paginated list of feature flags.',
  })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  async list(
    @CurrentUser() user: AuthenticatedSession | undefined,
    @CurrentApiKey() apiKey: AuthenticatedApiKey | undefined,
    @Query() filter: CursorPaginationDto,
  ): Promise<ListResponseDto<FeatureFlagDto>> {
    const result = await this.queryBus.execute(
      new ListFeatureFlagsQuery(
        resolveOrganizationId(user, apiKey),
        filter.limit,
        filter.startingAfter,
      ),
    );

    return toCursorListResponse({
      url: FEATURE_FLAGS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }

  @Get('evaluate')
  @RequirePermission(PERMISSIONS.FEATURE_FLAG_READ)
  @AllowApiKey()
  @ApiSecurity('apiKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve every flag for the calling subject',
    description:
      'Returns `{ key: boolean }` for every flag in the organization. Bucketing is deterministic: the subject is the calling user, or the API key when the caller is a machine, so the same subject always lands on the same side of a partial rollout.',
  })
  @ApiOkResponse({ type: EvaluatedFlagsResponseDto, description: 'Resolved flags.' })
  @ApiCommonErrors({ auth: true, forbidden: true })
  evaluate(
    @CurrentUser() user: AuthenticatedSession | undefined,
    @CurrentApiKey() apiKey: AuthenticatedApiKey | undefined,
  ): Promise<EvaluatedFlagsDto> {
    return this.queryBus.execute(
      new EvaluateFeatureFlagsQuery(
        resolveOrganizationId(user, apiKey),
        apiKey?.apiKeyId ?? (user as AuthenticatedSession).userId,
      ),
    );
  }

  @Post()
  @RequirePermission(PERMISSIONS.FEATURE_FLAG_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a feature flag' })
  @ApiCreatedResponse({ type: FeatureFlagResponseDto, description: 'Flag created.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true, conflict: true })
  create(
    @CurrentUser() user: AuthenticatedSession,
    @Body() dto: CreateFeatureFlagDto,
  ): Promise<FeatureFlagDto> {
    return this.commandBus.execute(
      new CreateFeatureFlagCommand({
        organizationId: resolveOrganizationId(user, undefined),
        key: dto.key,
        description: dto.description,
        enabled: dto.enabled,
        rolloutPercentage: dto.rolloutPercentage,
      }),
    );
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.FEATURE_FLAG_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a feature flag',
    description: 'Only the fields present in the payload change. `key` is immutable.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Feature flag id (UUID v7).' })
  @ApiOkResponse({ type: FeatureFlagResponseDto, description: 'Flag updated.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true, notFound: true })
  update(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() dto: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagDto> {
    return this.commandBus.execute(
      new UpdateFeatureFlagCommand({
        organizationId: resolveOrganizationId(user, undefined),
        id,
        description: dto.description,
        enabled: dto.enabled,
        rolloutPercentage: dto.rolloutPercentage,
      }),
    );
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.FEATURE_FLAG_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a feature flag',
    description: 'Clients checking the key stop seeing it in `evaluate` on the next call.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Feature flag id (UUID v7).' })
  @ApiNoContentResponse({ description: 'Flag deleted.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true })
  remove(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.commandBus.execute(
      new DeleteFeatureFlagCommand(resolveOrganizationId(user, undefined), id),
    );
  }
}
