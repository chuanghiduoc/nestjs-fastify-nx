import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { REQUEST_CONTEXT_KEYS, type RequestContextStore } from '@nestjs-fastify-nx/core';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { RequirePermission } from '@nestjs-fastify-nx/infra-authorization';
import type { PresignedUpload, StoredFile } from '@nestjs-fastify-nx/infra-storage';
import {
  CurrentUser,
  requireOrganizationId,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import { PresignUploadCommand } from '../../application/commands/presign-upload/presign-upload.command';
import { ConfirmUploadCommand } from '../../application/commands/confirm-upload/confirm-upload.command';
import { DeleteUploadCommand } from '../../application/commands/delete-upload/delete-upload.command';
import { PresignUploadDto } from '../dto/presign-upload.dto';
import { ConfirmUploadDto } from '../dto/confirm-upload.dto';
import { PresignedUploadDto } from '../dto/presigned-upload.dto';
import { StoredFileDto } from '../dto/stored-file.dto';

const PRESIGN_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const CONFIRM_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const DELETE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('upload')
@Controller('upload')
@ApiCookieAuth('session')
export class UploadController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly cls: ClsService<RequestContextStore>,
  ) {}

  @Post('presign')
  @RequirePermission(PERMISSIONS.FILE_CREATE)
  @Throttle(PRESIGN_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue a presigned POST policy for a direct browser→S3 upload.',
    description:
      'Returns the URL and form fields a browser must POST `multipart/form-data` to. The policy pins `Content-Type` and the configured size cap (UPLOAD_MAX_FILE_BYTES); mismatches are rejected by S3 itself. After the upload completes, call `POST /upload/confirm` with the returned `key`.',
  })
  @ApiBody({ type: PresignUploadDto })
  @ApiCreatedResponse({ type: PresignedUploadDto, description: 'Presigned upload policy issued.' })
  @ApiCommonErrors({ auth: true })
  presign(
    @CurrentUser() user: AuthenticatedSession,
    @Body() dto: PresignUploadDto,
  ): Promise<PresignedUpload> {
    return this.commandBus.execute(new PresignUploadCommand(user.userId, dto.contentType));
  }

  @Post('confirm')
  @RequirePermission(PERMISSIONS.FILE_CREATE)
  @Throttle(CONFIRM_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a direct upload completed and return its stored metadata.',
    description:
      'HEADs the object to verify the client actually uploaded within the policy. Rejects keys that are missing, oversized, or have a mime type outside the allow-list (defends against a stale/replayed presign).',
  })
  @ApiBody({ type: ConfirmUploadDto })
  @ApiOkResponse({ type: StoredFileDto, description: 'Object verified.' })
  // 409: a concurrent confirm of the same key can still be finalizing when this one recovers it.
  // notFound: cross-user or missing key.
  @ApiCommonErrors({ auth: true, notFound: true, conflict: true })
  confirm(
    @CurrentUser() user: AuthenticatedSession,
    @Body() dto: ConfirmUploadDto,
  ): Promise<StoredFile> {
    // BullMQ processing runs outside the request's CLS context, so the id travels on the command.
    const correlationId = this.cls.get(REQUEST_CONTEXT_KEYS.correlationId);
    return this.commandBus.execute(
      new ConfirmUploadCommand(requireOrganizationId(user), user.userId, dto.key, correlationId),
    );
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.FILE_DELETE)
  @Throttle(DELETE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete an uploaded file.',
    description:
      'Marks the file deleted and hides it from every read immediately. The object stays in storage until the scheduler purges it after STORED_FILE_PURGE_AFTER_DAYS, so a mistaken delete is recoverable until then. Repeating the call on an already-deleted file is a no-op.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Stored file id (UUID v7).' })
  @ApiNoContentResponse({ description: 'File soft-deleted.' })
  @ApiCommonErrors({ auth: true, notFound: true })
  deleteFile(
    @CurrentUser() user: AuthenticatedSession,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<void> {
    return this.commandBus.execute(
      new DeleteUploadCommand(requireOrganizationId(user), user.userId, id),
    );
  }
}
