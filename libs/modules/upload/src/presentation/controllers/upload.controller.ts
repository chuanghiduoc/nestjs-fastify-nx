import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
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
  ApiTags,
} from '@nestjs/swagger';
import { ApiCommonErrors } from '@nestjs-fastify-nx/contracts';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import { STORAGE_PORT } from '@nestjs-fastify-nx/infra-storage';
import type { PresignedUpload, StoragePort, StoredFile } from '@nestjs-fastify-nx/infra-storage';
import { BetterAuthGuard } from '@nestjs-fastify-nx/infra-auth';
import {
  ALLOWED_MIME_TYPES,
  detectFileType,
  generateId,
  positiveIntEnv,
} from '@nestjs-fastify-nx/shared';
import { PresignUploadDto } from '../dto/presign-upload.dto';
import { ConfirmUploadDto } from '../dto/confirm-upload.dto';
import { PresignedUploadDto } from '../dto/presigned-upload.dto';
import { StoredFileDto } from '../dto/stored-file.dto';

const MAGIC_BYTES_TO_READ = 16;

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const PRESIGN_EXPIRES_SECONDS = 5 * 60;

const PRESIGN_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const CONFIRM_LIMIT = { default: { limit: 30, ttl: 60_000 } };

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

@ApiTags('upload')
@Controller('upload')
@UseGuards(BetterAuthGuard)
@ApiCookieAuth('session')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);
  // Must mirror @fastify/multipart cap in main.ts so both layers reject at the same threshold.
  private readonly maxFileSize: number;

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @InjectQueue(QUEUE_NAMES.UPLOAD_VERIFICATION) private readonly verifyQueue: Queue,
  ) {
    this.maxFileSize = positiveIntEnv('UPLOAD_MAX_FILE_BYTES', DEFAULT_MAX_FILE_SIZE);
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
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        messageKey: I18N_KEYS.errors.upload.mime_not_allowed,
        args: { contentType: dto.contentType },
        message: `Mime type "${dto.contentType}" is not allowed`,
      });
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
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        messageKey: I18N_KEYS.errors.upload.object_not_found,
        args: { key: dto.key },
        message: `No object stored at "${dto.key}"`,
      });
    }

    if (!ALLOWED_MIME_TYPES.has(meta.contentType)) {
      await this.storage.delete(dto.key).catch(() => undefined);
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        messageKey: I18N_KEYS.errors.upload.mime_not_allowed,
        args: { contentType: meta.contentType },
        message: `Mime type "${meta.contentType}" is not allowed`,
      });
    }

    if (meta.size <= 0 || meta.size > this.maxFileSize) {
      await this.storage.delete(dto.key).catch(() => undefined);
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        messageKey: I18N_KEYS.errors.upload.size_out_of_range,
        args: { size: meta.size, max: this.maxFileSize },
        message: `Object size ${meta.size} bytes is outside the allowed range (1..${this.maxFileSize})`,
      });
    }

    // Inline check: if the queue is unreachable this still blocks tampered uploads.
    const head = await this.storage.readRange(dto.key, MAGIC_BYTES_TO_READ, meta.bucket);
    const detected = detectFileType(head);
    if (!detected || detected.mimeType !== meta.contentType) {
      await this.storage.delete(dto.key).catch(() => undefined);
      throw new BadRequestException(
        detected
          ? {
              statusCode: HttpStatus.BAD_REQUEST,
              messageKey: I18N_KEYS.errors.upload.magic_bytes_mismatch,
              args: { detected: detected.mimeType, declared: meta.contentType },
              message: `Magic bytes indicate "${detected.mimeType}" but Content-Type is "${meta.contentType}"`,
            }
          : {
              statusCode: HttpStatus.BAD_REQUEST,
              messageKey: I18N_KEYS.errors.upload.magic_bytes_unknown,
              args: { key: dto.key },
              message: `Object at "${dto.key}" has no recognized binary signature`,
            },
      );
    }

    // Untagged objects auto-expire in 24h — fail explicitly so the client retries.
    try {
      await this.storage.commit(dto.key);
    } catch (err) {
      this.logger.error({ err, key: dto.key }, 'commit tag failed — lifecycle will expire object');
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        messageKey: I18N_KEYS.errors.upload.commit_failed,
        message: 'Failed to commit upload; please retry',
      });
    }

    // Async deep verification (virus scan, EXIF strip) — best-effort; inline check already blocked tampering.
    await this.verifyQueue
      .add(
        'verify-magic-bytes',
        { key: dto.key, declaredContentType: meta.contentType, bucket: meta.bucket },
        {
          // BullMQ rejects ':' in jobIds — '__' separator; '/' normalised to '_'.
          jobId: `verify__${dto.key.replace(/\//g, '_')}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      )
      .catch((err) => {
        this.logger.warn({ err, key: dto.key }, 'enqueue verify-magic-bytes failed');
      });

    const url = await this.storage.getSignedUrl(dto.key);
    return { key: dto.key, url, bucket: meta.bucket, size: meta.size };
  }
}
