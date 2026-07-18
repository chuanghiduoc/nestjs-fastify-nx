import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
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
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { STORAGE_PORT } from '@nestjs-fastify-nx/infra-storage';
import type { PresignedUpload, StoragePort, StoredFile } from '@nestjs-fastify-nx/infra-storage';
import type { AuthenticatedSession } from '@nestjs-fastify-nx/infra-auth';
import type { FastifyRequest } from 'fastify';
import {
  ALLOWED_MIME_TYPES,
  detectFileType,
  generateId,
  MIME_EXTENSIONS,
  positiveIntEnv,
  STORED_FILE_STATUS,
} from '@nestjs-fastify-nx/shared';

import type { StoredFile as StoredFileRecord } from '@nestjs-fastify-nx/infra-database';
import { PresignUploadDto } from '../dto/presign-upload.dto';
import { ConfirmUploadDto } from '../dto/confirm-upload.dto';
import { PresignedUploadDto } from '../dto/presigned-upload.dto';
import { StoredFileDto } from '../dto/stored-file.dto';

const MAGIC_BYTES_TO_READ = 16;

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const PRESIGN_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const CONFIRM_LIMIT = { default: { limit: 30, ttl: 60_000 } };

export function verificationJobId(storageKey: string): string {
  // A delimiter replacement is not injective (`a/b_c` and `a_b/c` collide). Hash the complete
  // object key so retries deduplicate while distinct uploads can never share a BullMQ job id.
  return `verify__${createHash('sha256').update(storageKey).digest('hex')}`;
}

@ApiTags('upload')
@Controller('upload')
@ApiCookieAuth('session')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);
  // Sourced from UPLOAD_MAX_FILE_BYTES — caps the presign policy and the confirm-time size check.
  // (Uploads go direct-to-S3 via presign, so there is no server-side multipart body to bound.)
  private readonly maxFileSize: number;
  private readonly presignExpiresSeconds: number;

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @InjectQueue(QUEUE_NAMES.UPLOAD_VERIFICATION) private readonly verifyQueue: Queue,
    private readonly prisma: PrismaService,
  ) {
    this.maxFileSize = positiveIntEnv('UPLOAD_MAX_FILE_BYTES', DEFAULT_MAX_FILE_SIZE);
    this.presignExpiresSeconds = positiveIntEnv('UPLOAD_PRESIGN_EXPIRES_SECONDS', 300);
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
  @ApiCommonErrors({ auth: true })
  async presign(
    @Req() req: FastifyRequest & { user: AuthenticatedSession },
    @Body() dto: PresignUploadDto,
  ): Promise<PresignedUpload> {
    const extension = MIME_EXTENSIONS.get(dto.contentType);
    if (!extension) {
      throw new BadRequestException({
        messageKey: I18N_KEYS.errors.upload.mime_not_allowed,
        args: { contentType: dto.contentType },
        message: `Mime type "${dto.contentType}" is not allowed`,
      });
    }

    // The user id in the prefix makes the otherwise bearer-like storage key tenant-scoped.
    const key = `uploads/${req.user.userId}/${generateId()}.${extension}`;
    return this.storage.presignUpload(key, {
      contentType: dto.contentType,
      maxBytes: this.maxFileSize,
      expiresInSeconds: this.presignExpiresSeconds,
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
  @ApiCommonErrors({ auth: true, notFound: true })
  async confirm(
    @Req() req: FastifyRequest & { user: AuthenticatedSession },
    @Body() dto: ConfirmUploadDto,
  ): Promise<StoredFile> {
    // Treat a cross-user key as missing so object existence is not disclosed. Shape validation
    // happens in ConfirmUploadDto; this ownership check must run before any S3 request.
    if (!dto.key.startsWith(`uploads/${req.user.userId}/`)) {
      throw this.objectNotFound(dto.key);
    }

    const existing = await this.prisma.db.storedFile.findUnique({
      where: { sourceKey: dto.key },
    });
    if (existing) return this.recoverExisting(existing);

    const meta = await this.storage.head(dto.key);
    if (!meta) {
      throw this.objectNotFound(dto.key);
    }

    // 422, not 400: the body already passed ConfirmUploadDto — it is the referenced S3 object that
    // breaks policy. 413 would be wrong for oversize too; the request payload is a few bytes.
    if (!ALLOWED_MIME_TYPES.has(meta.contentType)) {
      await this.safeDelete(dto.key);
      throw new UnprocessableEntityException({
        messageKey: I18N_KEYS.errors.upload.mime_not_allowed,
        args: { contentType: meta.contentType },
        message: `Mime type "${meta.contentType}" is not allowed`,
      });
    }

    if (meta.size <= 0 || meta.size > this.maxFileSize) {
      await this.safeDelete(dto.key);
      throw new UnprocessableEntityException({
        messageKey: I18N_KEYS.errors.upload.size_out_of_range,
        args: { size: meta.size, max: this.maxFileSize },
        message: `Object size ${meta.size} bytes is outside the allowed range (1..${this.maxFileSize})`,
      });
    }

    // Inline check: if the queue is unreachable this still blocks tampered uploads.
    const head = await this.storage.readRange(dto.key, MAGIC_BYTES_TO_READ, meta.bucket);
    const detected = detectFileType(head);
    if (!detected || detected.mimeType !== meta.contentType) {
      await this.safeDelete(dto.key);
      throw new UnprocessableEntityException(
        detected
          ? {
              messageKey: I18N_KEYS.errors.upload.magic_bytes_mismatch,
              args: { detected: detected.mimeType, declared: meta.contentType },
              message: `Magic bytes indicate "${detected.mimeType}" but Content-Type is "${meta.contentType}"`,
            }
          : {
              messageKey: I18N_KEYS.errors.upload.magic_bytes_unknown,
              args: { key: dto.key },
              message: `Object at "${dto.key}" has no recognized binary signature`,
            },
      );
    }

    // Publish to a fresh immutable key. The ETag precondition binds the copy to the exact object
    // version checked above, closing the HEAD/read/copy race. A replay can create another file but
    // can never overwrite a key already returned to a client.
    const dotIndex = dto.key.lastIndexOf('.');
    const extension = dotIndex >= 0 ? dto.key.slice(dotIndex) : '';
    const fileId = generateId();
    const finalKey = `files/${req.user.userId}/${fileId}${extension}`;
    // Signing is offline and does not require the destination to exist. Do it before the
    // destructive finalize step so a signing/configuration failure leaves staging retryable.
    const url = await this.storage.getSignedUrl(finalKey, undefined, meta.bucket);
    try {
      await this.prisma.db.storedFile.create({
        data: {
          id: fileId,
          userId: req.user.userId,
          sourceKey: dto.key,
          key: finalKey,
          bucket: meta.bucket,
          contentType: meta.contentType,
          size: meta.size,
          etag: meta.etag,
          status: STORED_FILE_STATUS.FINALIZING,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        const concurrent = await this.prisma.db.storedFile.findUnique({
          where: { sourceKey: dto.key },
        });
        if (concurrent) return this.recoverExisting(concurrent);
      }
      throw err;
    }

    try {
      await this.storage.finalize(dto.key, finalKey, meta.etag, meta.bucket);
    } catch (err) {
      await this.prisma.db.storedFile
        .deleteMany({ where: { id: fileId, status: STORED_FILE_STATUS.FINALIZING } })
        .catch(() => undefined);
      this.logger.error(
        { err, sourceKey: dto.key, finalKey },
        'upload finalize failed — staging object remains lifecycle-managed',
      );
      throw new InternalServerErrorException({
        messageKey: I18N_KEYS.errors.upload.commit_failed,
        message: 'Failed to finalize upload; please retry',
      });
    }

    // CAS on FINALIZING (mirrors every other status write in this flow) rather than update-by-id:
    // if an orphan purge deleted the row after the owner was hard-deleted mid-confirm, a plain
    // update() would throw a raw P2025 500 even though finalize already succeeded.
    const transitioned = await this.prisma.db.storedFile.updateMany({
      where: { id: fileId, status: STORED_FILE_STATUS.FINALIZING },
      data: { status: STORED_FILE_STATUS.VERIFYING },
    });
    if (transitioned.count === 0) {
      this.logger.error({ fileId, finalKey }, 'stored-file row missing at VERIFYING transition');
      throw new InternalServerErrorException({
        messageKey: I18N_KEYS.errors.upload.commit_failed,
        message: 'Failed to finalize upload; please retry',
      });
    }

    // Asynchronous defense-in-depth recheck on the immutable final object. Future scanners can
    // extend this queue, but the current worker intentionally verifies magic bytes only.
    await this.verifyQueue
      .add(
        'verify-magic-bytes',
        { key: finalKey, declaredContentType: meta.contentType, bucket: meta.bucket },
        {
          jobId: verificationJobId(finalKey),
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      )
      .catch((err: unknown) => {
        this.logger.error({ err, key: finalKey }, 'enqueue verify-magic-bytes failed');
        throw err;
      });

    return { key: finalKey, url, bucket: meta.bucket, size: meta.size };
  }

  private async recoverExisting(record: StoredFileRecord): Promise<StoredFile> {
    if (record.status === STORED_FILE_STATUS.REJECTED) {
      throw this.objectNotFound(record.sourceKey);
    }

    const finalMeta = await this.storage.head(record.key, record.bucket);
    if (!finalMeta) {
      throw new ConflictException({
        message: 'Upload confirmation is still in progress; retry shortly',
      });
    }

    if (record.status === STORED_FILE_STATUS.FINALIZING) {
      await this.prisma.db.storedFile.updateMany({
        where: { id: record.id, status: STORED_FILE_STATUS.FINALIZING },
        data: { status: STORED_FILE_STATUS.VERIFYING },
      });
    }

    if (record.status !== STORED_FILE_STATUS.READY) {
      await this.verifyQueue
        .add(
          'verify-magic-bytes',
          { key: record.key, declaredContentType: record.contentType, bucket: record.bucket },
          {
            jobId: verificationJobId(record.key),
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
          },
        )
        .catch((err: unknown) => {
          this.logger.error({ err, key: record.key }, 'enqueue verify-magic-bytes failed');
          throw err;
        });
    }

    const url = await this.storage.getSignedUrl(record.key, undefined, record.bucket);
    return { key: record.key, url, bucket: record.bucket, size: record.size };
  }

  // Best-effort cleanup of a rejected upload. A failed delete must not mask the
  // validation error that triggered it, but silently swallowing it orphans the object
  // until the 24h lifecycle expiry — so surface it for observability.
  private async safeDelete(key: string): Promise<void> {
    await this.storage.delete(key).catch((err: unknown) => {
      this.logger.warn(
        { err, key },
        'cleanup delete failed — object orphaned until lifecycle expiry',
      );
    });
  }

  private objectNotFound(key: string): NotFoundException {
    return new NotFoundException({
      messageKey: I18N_KEYS.errors.upload.object_not_found,
      args: { key },
      message: `No object stored at "${key}"`,
    });
  }
}
