import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import {
  PresignedUpload,
  STORAGE_PORT,
  StoragePort,
  StoredFile,
} from '@nestjs-fastify-nx/infra-storage';
import { BetterAuthGuard } from '@nestjs-fastify-nx/infra-auth';
import { generateId } from '@nestjs-fastify-nx/shared';
import { ALLOWED_MIME_TYPES } from './file-signature';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PRESIGN_EXPIRES_SECONDS = 5 * 60;
const ALLOWED_MIME_LIST = Array.from(ALLOWED_MIME_TYPES);

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

class PresignUploadDto {
  @ApiProperty({
    description: 'Declared MIME type of the file the client intends to upload.',
    enum: ALLOWED_MIME_LIST,
    example: 'image/png',
  })
  @IsString()
  @IsIn(ALLOWED_MIME_LIST)
  contentType!: string;
}

class ConfirmUploadDto {
  @ApiProperty({
    description: 'Storage key returned by the previous /upload/presign call.',
    example: 'uploads/019dd1a5-9235-70db-8d57-54ef901d8185.png',
    maxLength: 256,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @Matches(/^uploads\/[A-Za-z0-9._-]+$/, {
    message: 'key must be a previously issued uploads/<id>.<ext> path',
  })
  key!: string;
}

class PresignedUploadDto implements PresignedUpload {
  @ApiProperty({
    description: 'Endpoint the browser POSTs the multipart form to.',
    example: 'https://s3.example.com/app-uploads',
    format: 'uri',
  })
  url!: string;

  @ApiProperty({
    description:
      'Form fields to include alongside the `file` part. Submit them in order — `file` MUST be last.',
    example: {
      'Content-Type': 'image/png',
      bucket: 'app-uploads',
      key: 'uploads/019dd1a5-9235-70db-8d57-54ef901d8185.png',
      Policy: '...',
      'X-Amz-Signature': '...',
    },
    additionalProperties: { type: 'string' },
  })
  fields!: Record<string, string>;

  @ApiProperty({
    description: 'Storage key the file will land under — pass back to /upload/confirm.',
    example: 'uploads/019dd1a5-9235-70db-8d57-54ef901d8185.png',
  })
  key!: string;

  @ApiProperty({ description: 'Storage bucket the file will land in.', example: 'app-uploads' })
  bucket!: string;

  @ApiProperty({
    description: 'ISO timestamp after which the presigned policy is rejected by S3.',
    example: '2026-05-01T08:30:00.000Z',
    format: 'date-time',
  })
  expiresAt!: string;

  @ApiProperty({
    description: 'Maximum bytes the policy will accept — clients should validate locally too.',
    example: MAX_FILE_SIZE,
  })
  maxBytes!: number;
}

class StoredFileDto implements StoredFile {
  @ApiProperty({
    description: 'Storage key under which the file was persisted.',
    example: 'uploads/019dd1a5-9235-70db-8d57-54ef901d8185.png',
  })
  key!: string;

  @ApiProperty({
    description: 'Public URL of the stored file (presigned or CDN — depends on storage adapter).',
    example: 'https://cdn.example.com/uploads/019dd1a5-9235-70db-8d57-54ef901d8185.png',
    format: 'uri',
  })
  url!: string;

  @ApiProperty({ description: 'Storage bucket the file landed in.', example: 'app-uploads' })
  bucket!: string;

  @ApiProperty({ description: 'Size in bytes.', example: 12345 })
  size!: number;
}

@ApiTags('upload')
@Controller('upload')
@UseGuards(BetterAuthGuard)
@ApiCookieAuth('session')
export class UploadController {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}

  @Post('presign')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue a presigned POST policy for a direct browser→S3 upload.',
    description:
      'Returns the URL and form fields a browser must POST `multipart/form-data` to. The policy pins `Content-Type` and a 10 MB size cap; mismatches are rejected by S3 itself. After the upload completes, call `POST /upload/confirm` with the returned `key`.',
  })
  @ApiBody({ type: PresignUploadDto })
  @ApiCreatedResponse({ type: PresignedUploadDto, description: 'Presigned upload policy issued.' })
  @ApiCommonErrors({ auth: true, forbidden: false })
  async presign(@Body() dto: PresignUploadDto): Promise<PresignedUpload> {
    const extension = MIME_EXTENSIONS[dto.contentType];
    if (!extension) {
      // Defence in depth — DTO already enforces the allow-list.
      throw new BadRequestException(`Mime type "${dto.contentType}" is not allowed`);
    }

    const key = `uploads/${generateId()}.${extension}`;
    return this.storage.presignUpload(key, {
      contentType: dto.contentType,
      maxBytes: MAX_FILE_SIZE,
      expiresInSeconds: PRESIGN_EXPIRES_SECONDS,
    });
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a direct upload completed and return its stored metadata.',
    description:
      'HEADs the object to verify the client actually uploaded within the policy. Rejects keys that are missing, oversized, or have a mime type outside the allow-list (defends against a stale/replayed presign).',
  })
  @ApiBody({ type: ConfirmUploadDto })
  @ApiOkResponse({ type: StoredFileDto, description: 'Object verified.' })
  @ApiCommonErrors({ auth: true, forbidden: false, notFound: true })
  async confirm(@Body() dto: ConfirmUploadDto): Promise<StoredFile> {
    const meta = await this.storage.head(dto.key);
    if (!meta) {
      throw new NotFoundException(`No object stored at "${dto.key}"`);
    }

    if (!ALLOWED_MIME_TYPES.has(meta.contentType)) {
      // Best-effort cleanup of the rogue object so it does not linger.
      await this.storage.delete(dto.key).catch(() => undefined);
      throw new BadRequestException(`Mime type "${meta.contentType}" is not allowed`);
    }

    if (meta.size <= 0 || meta.size > MAX_FILE_SIZE) {
      await this.storage.delete(dto.key).catch(() => undefined);
      throw new BadRequestException(
        `Object size ${meta.size} bytes is outside the allowed range (1..${MAX_FILE_SIZE})`,
      );
    }

    const url = await this.storage.getSignedUrl(dto.key);
    return { key: dto.key, url, bucket: meta.bucket, size: meta.size };
  }
}
