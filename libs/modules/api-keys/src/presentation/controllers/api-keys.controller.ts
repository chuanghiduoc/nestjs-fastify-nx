import {
  Body,
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
import { Throttle } from '@nestjs/throttler';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { ListApiKeysQuery } from '../../application/queries/list-api-keys/list-api-keys.query';
import { CreateApiKeyCommand } from '../../application/commands/create-api-key/create-api-key.command';
import { RevokeApiKeyCommand } from '../../application/commands/revoke-api-key/revoke-api-key.command';
import type { ApiKeyDto, IssuedApiKeyDto } from '../../application/dto/api-key.dto';
import {
  ApiKeyResponseDto,
  CreateApiKeyDto,
  IssuedApiKeyResponseDto,
  ListApiKeysFilterDto,
} from '../dto/api-key.dto';

const API_KEYS_PATH = '/api/v1/api-keys';
const CREATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('api-keys')
@Controller('api-keys')
@ApiCookieAuth('session')
export class ApiKeysController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.API_KEY_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List API keys of the active organization',
    description:
      'Cursor-paginated, newest first. Only the non-secret `prefix` is returned — the raw key exists in the response of `POST /api-keys` and nowhere else. Revoked keys are hidden unless `includeRevoked=true`.',
  })
  @ApiPaginatedResponse(ApiKeyResponseDto, { description: 'Cursor-paginated list of API keys.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  async list(
    @CurrentUser() user: AuthenticatedSession,
    @Query() filter: ListApiKeysFilterDto,
  ): Promise<ListResponseDto<ApiKeyDto>> {
    const result = await this.queryBus.execute(
      new ListApiKeysQuery(requireOrganizationId(user), filter.limit, {
        startingAfter: filter.startingAfter,
        includeRevoked: filter.includeRevoked,
      }),
    );

    return toCursorListResponse({
      url: API_KEYS_PATH,
      items: result.data,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    });
  }

  @Post()
  @RequirePermission(PERMISSIONS.API_KEY_CREATE)
  @Throttle(CREATE_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue an API key for machine-to-machine access',
    description:
      'Returns the raw key once, in this response. Only its SHA-256 digest is stored, so a lost key cannot be recovered — issue a new one and revoke the old. Requested scopes are rejected with 422 when they exceed the permissions the calling member holds.',
  })
  @ApiCreatedResponse({
    type: IssuedApiKeyResponseDto,
    description: 'Key issued. `key` is shown only here.',
  })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true })
  create(
    @CurrentUser() user: AuthenticatedSession,
    @Body() dto: CreateApiKeyDto,
  ): Promise<IssuedApiKeyDto> {
    return this.commandBus.execute(
      new CreateApiKeyCommand({
        organizationId: requireOrganizationId(user),
        userId: user.userId,
        name: dto.name,
        scopes: dto.scopes,
        expiresAt: dto.expiresAt,
      }),
    );
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.API_KEY_REVOKE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke an API key',
    description:
      'Takes effect on the next request that presents the key. Revoking an already-revoked key is a no-op, so a retried call stays safe.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'API key id (UUID v7).' })
  @ApiNoContentResponse({ description: 'Key revoked.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true })
  revoke(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.commandBus.execute(new RevokeApiKeyCommand(requireOrganizationId(user), id));
  }
}
