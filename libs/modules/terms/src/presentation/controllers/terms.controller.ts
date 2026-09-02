import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { FastifyRequest } from 'fastify';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiCommonErrors, ListResponseDto, toListResponse } from '@nestjs-fastify-nx/contracts';
import { CurrentUser, Roles, type AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import { PERMISSIONS, PLATFORM_ROLES } from '@nestjs-fastify-nx/shared';
import { ListPublishedTermsQuery } from '../../application/queries/list-published-terms/list-published-terms.query';
import { GetLatestTermQuery } from '../../application/queries/get-latest-term/get-latest-term.query';
import { ListMyTermAcceptancesQuery } from '../../application/queries/list-my-term-acceptances/list-my-term-acceptances.query';
import { CreateTermCommand } from '../../application/commands/create-term/create-term.command';
import { PublishTermCommand } from '../../application/commands/publish-term/publish-term.command';
import { AcceptTermCommand } from '../../application/commands/accept-term/accept-term.command';
import type { TermAcceptanceDto, TermDto } from '../../application/dto/term.dto';
import { TERM_TYPE, TERM_TYPES, type TermType } from '../../domain/entities/term.entity';
import { CreateTermDto, TermResponseDto } from '../dto/term.dto';

const TERMS_PATH = '/api/v1/terms';
const ACCEPTANCES_PATH = '/api/v1/terms/acceptances';

@ApiTags('terms')
@Controller('terms')
@ApiCookieAuth('session')
export class TermsController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.TERM_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List published legal documents',
    description:
      'Returns every published version, newest first per type. Unpublished drafts are never exposed here. The set is small and bounded, so it is not paginated.',
  })
  @ApiOkResponse({ type: ListResponseDto, description: 'Published terms.' })
  @ApiCommonErrors({ auth: true, forbidden: true })
  async list(): Promise<ListResponseDto<TermDto>> {
    const result = await this.queryBus.execute(new ListPublishedTermsQuery());

    return toListResponse({
      url: TERMS_PATH,
      items: result.data,
      page: 1,
      pageSize: result.data.length,
      total: result.data.length,
    });
  }

  @Get('acceptances')
  @RequirePermission(PERMISSIONS.TERM_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the versions the caller has accepted',
    description:
      'Used by a client to decide whether to prompt for re-acceptance after a new version is published.',
  })
  @ApiOkResponse({ type: ListResponseDto, description: 'The caller’s acceptances.' })
  @ApiCommonErrors({ auth: true, forbidden: true })
  async acceptances(
    @CurrentUser() user: AuthenticatedSession,
  ): Promise<ListResponseDto<TermAcceptanceDto>> {
    const result = await this.queryBus.execute(new ListMyTermAcceptancesQuery(user.userId));

    return toListResponse({
      url: ACCEPTANCES_PATH,
      items: result.data,
      page: 1,
      pageSize: result.data.length,
      total: result.data.length,
    });
  }

  @Get(':type/latest')
  @RequirePermission(PERMISSIONS.TERM_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read the newest published version of one document' })
  @ApiParam({ name: 'type', enum: TERM_TYPES })
  @ApiOkResponse({ type: TermResponseDto, description: 'Latest published version.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true, notFound: true })
  latest(@Param('type', new ParseEnumPipe(TERM_TYPE)) type: TermType): Promise<TermDto> {
    return this.queryBus.execute(new GetLatestTermQuery(type));
  }

  @Post()
  @Roles(PLATFORM_ROLES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new version of a legal document',
    description:
      'Versions are immutable once created — publish a new version rather than editing a published one.',
  })
  @ApiCreatedResponse({ type: TermResponseDto, description: 'Version created.' })
  @ApiCommonErrors({ auth: true, forbidden: true, validation: true, conflict: true })
  create(@Body() dto: CreateTermDto): Promise<TermDto> {
    return this.commandBus.execute(
      new CreateTermCommand({
        type: dto.type,
        version: dto.version,
        content: dto.content,
        publish: dto.publish,
      }),
    );
  }

  @Post(':id/publish')
  @Roles(PLATFORM_ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish a draft version',
    description:
      'Idempotent: publishing an already-published version keeps its original date, because when a document became binding is a legal fact.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Term id (UUID v7).' })
  @ApiOkResponse({ type: TermResponseDto, description: 'Version published.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true })
  publish(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string): Promise<TermDto> {
    return this.commandBus.execute(new PublishTermCommand(id));
  }

  @Post(':id/accept')
  @RequirePermission(PERMISSIONS.TERM_ACCEPT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Record that the caller accepted a version',
    description:
      'Idempotent: re-accepting keeps the first timestamp, so a retried request cannot rewrite when consent was given. Accepting an unpublished version answers 409.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Term id (UUID v7).' })
  @ApiNoContentResponse({ description: 'Acceptance recorded.' })
  @ApiCommonErrors({ auth: true, forbidden: true, notFound: true, conflict: true })
  accept(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.commandBus.execute(new AcceptTermCommand(user.userId, id, request.ip ?? null));
  }
}
