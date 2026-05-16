import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Throttle } from '@nestjs/throttler';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
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
import { ALLOWED_MIME_TYPES, generateId } from '@nestjs-fastify-nx/shared';

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const PRESIGN_EXPIRES_SECONDS = 5 * 60;
const ALLOWED_MIME_LIST = Array.from(ALLOWED_MIME_TYPES);

// Per-route throttle on top of the global ThrottlerGuard. /presign is the
// expensive side (mints S3 policy + creates an orphan key); /confirm is
// cheaper but still rate-limited to defeat key-enumeration attempts.
const PRESIGN_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const CONFIRM_LIMIT = { default: { limit: 30, ttl: 60_000 } };

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
    example: DEFAULT_MAX_FILE_SIZE,
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
  private readonly logger = new Logger(UploadController.name);
  // Mirrors the cap enforced by @fastify/multipart in main.ts so both the
  // parser-level and policy-level rejections trigger at the same threshold.
  private readonly maxFileSize: number;

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @InjectQueue(QUEUE_NAMES.UPLOAD_VERIFICATION) private readonly verifyQueue: Queue,
  ) {
    const raw = process.env['UPLOAD_MAX_FILE_BYTES'];
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    this.maxFileSize = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FILE_SIZE;
  }

  @Post('presign')
  @Throttle(PRESIGN_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue a presigned POST policy for a direct browser→S3 upload.',
    description:
      'Returns the URL and form fields a browser must POST `multipart/form-data` to. The policy pins `Content-Type` and the configured size cap (UPLOAD_MAX_FILE_BYTES); mismatches are rejected by S3 itself. After the upload completes, call `POST /upload/confirm` with the returned `key`.',
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
      maxBytes: this.maxFileSize,
      expiresInSeconds: PRESIGN_EXPIRES_SECONDS,
    });
  }

  @Post('confirm')
  @Throttle(CONFIRM_LIMIT)
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

    if (meta.size <= 0 || meta.size > this.maxFileSize) {
      await this.storage.delete(dto.key).catch(() => undefined);
      throw new BadRequestException(
        `Object size ${meta.size} bytes is outside the allowed range (1..${this.maxFileSize})`,
      );
    }

    // Tag the object so the S3 lifecycle rule preserves it. Untagged orphans
    // (presigned but never confirmed) auto-expire — see docs/runbook.md.
    await this.storage.commit(dto.key).catch((err) => {
      this.logger.warn(
        { err, key: dto.key },
        'commit tag failed (lifecycle may expire the object)',
      );
    });

    // Async magic-byte audit. We accept the upload now (HEAD already proved
    // declared MIME + size), but the worker re-reads the first 16 bytes and
    // deletes the object if the binary signature contradicts the declared
    // type. Non-blocking so the user gets their response immediately.
    await this.verifyQueue
      .add(
        'verify-magic-bytes',
        { key: dto.key, declaredContentType: meta.contentType, bucket: meta.bucket },
        {
          // Strip '/' from the key for the jobId — BullMQ uses ':' internally
          // and '/' is fine, but normalizing to '_' keeps jobId portable.
          jobId: `verify__${dto.key.replace(/\//g, '_')}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      )
      .catch((err) => {
        this.logger.error({ err, key: dto.key }, 'enqueue verify-magic-bytes failed');
      });

    const url = await this.storage.getSignedUrl(dto.key);
    return { key: dto.key, url, bucket: meta.bucket, size: meta.size };
  }
}
