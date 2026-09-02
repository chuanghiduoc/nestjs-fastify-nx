import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { DomainException, isDomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { generateId, STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import {
  STORAGE_PORT,
  type ObjectMetadata,
  type StoragePort,
  type StoredFile as StoredFileResult,
} from '@nestjs-fastify-nx/infra-storage';
import {
  assertMimeAllowed,
  assertOwnsSourceKey,
  assertSizeWithinLimit,
  objectNotFound,
  StoredFile,
} from '../../../domain/entities/stored-file.entity';
import { readHeadAndAssertMagicBytes } from '../../ports/read-magic-bytes';
import {
  isDuplicateKeyError,
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../../../domain/ports/stored-file-repository.port';
import { UPLOAD_LIMITS, type UploadLimits } from '../../upload-limits';
import {
  UPLOAD_VERIFICATION_DISPATCHER,
  type UploadVerificationDispatcher,
} from '../../ports/upload-verification.dispatcher';
import { ConfirmUploadCommand } from './confirm-upload.command';

function isPolicyViolation(err: unknown): boolean {
  return isDomainException(err) && err.kind === 'validation';
}

@CommandHandler(ConfirmUploadCommand)
export class ConfirmUploadHandler implements ICommandHandler<
  ConfirmUploadCommand,
  StoredFileResult
> {
  private readonly logger = new Logger(ConfirmUploadHandler.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepositoryPort,
    @Inject(UPLOAD_VERIFICATION_DISPATCHER)
    private readonly verification: UploadVerificationDispatcher,
    @Inject(UPLOAD_LIMITS) private readonly limits: UploadLimits,
  ) {}

  async execute(command: ConfirmUploadCommand): Promise<StoredFileResult> {
    // Ownership is checked before any storage call so a cross-user key never reaches S3.
    assertOwnsSourceKey(command.sourceKey, command.userId);

    const existing = await this.files.findBySourceKey(command.sourceKey);
    if (existing) return this.recoverExisting(existing, command.correlationId);

    const meta = await this.storage.head(command.sourceKey);
    if (!meta) throw objectNotFound(command.sourceKey);

    await this.validateStagedObject(command.sourceKey, meta);

    return this.publish(command, meta);
  }

  // A staged object that breaks policy is deleted before the failure propagates: leaving it would
  // keep an unvalidated blob addressable by its presigned key until the lifecycle rule expires it.
  private async validateStagedObject(sourceKey: string, meta: ObjectMetadata): Promise<void> {
    try {
      assertMimeAllowed(meta.contentType);
      assertSizeWithinLimit(meta.size, this.limits.maxFileBytes);

      // Inline check: if the queue is unreachable this still blocks a tampered upload.
      await readHeadAndAssertMagicBytes(
        { storage: this.storage, limits: this.limits },
        sourceKey,
        meta.contentType,
        meta.bucket,
      );
    } catch (err) {
      if (isPolicyViolation(err)) await this.safeDelete(sourceKey);
      throw err;
    }
  }

  private async publish(
    command: ConfirmUploadCommand,
    meta: ObjectMetadata,
  ): Promise<StoredFileResult> {
    // Publish to a fresh immutable key. The ETag precondition binds the copy to the exact object
    // version checked above, closing the HEAD/read/copy race. A replay can create another file but
    // can never overwrite a key already returned to a client.
    const dotIndex = command.sourceKey.lastIndexOf('.');
    const extension = dotIndex >= 0 ? command.sourceKey.slice(dotIndex) : '';
    const fileId = generateId();
    const finalKey = `files/${command.userId}/${fileId}${extension}`;

    try {
      await this.files.create({
        id: fileId,
        organizationId: command.organizationId,
        userId: command.userId,
        sourceKey: command.sourceKey,
        key: finalKey,
        bucket: meta.bucket,
        contentType: meta.contentType,
        size: meta.size,
        etag: meta.etag,
        status: STORED_FILE_STATUS.FINALIZING,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const concurrent = await this.files.findBySourceKey(command.sourceKey);
        if (concurrent) return this.recoverExisting(concurrent, command.correlationId);
      }
      throw err;
    }

    try {
      await this.storage.finalize(command.sourceKey, finalKey, meta.etag, meta.bucket);
    } catch (err) {
      await this.files.deleteIfStatus(fileId, STORED_FILE_STATUS.FINALIZING).catch(() => undefined);
      this.logger.error(
        { err, sourceKey: command.sourceKey, finalKey },
        'upload finalize failed — staging object remains lifecycle-managed',
      );
      throw this.commitFailed();
    }

    // CAS rather than update-by-id: if an orphan purge removed the row after the owner was
    // hard-deleted mid-confirm, update() would surface a raw P2025 500 even though finalize succeeded.
    const transitioned = await this.files.transition(
      fileId,
      STORED_FILE_STATUS.FINALIZING,
      STORED_FILE_STATUS.VERIFYING,
    );
    if (!transitioned) {
      this.logger.error({ fileId, finalKey }, 'stored-file row missing at VERIFYING transition');
      throw this.commitFailed();
    }

    // The immutable object stays quarantined: no signed URL is issued until the worker has checked
    // both its signature and its complete contents against the malware scanner.
    await this.verification.dispatch({
      key: finalKey,
      declaredContentType: meta.contentType,
      bucket: meta.bucket,
      correlationId: command.correlationId,
    });

    return { id: fileId, key: finalKey, bucket: meta.bucket, size: meta.size };
  }

  private async recoverExisting(
    record: StoredFile,
    correlationId?: string,
  ): Promise<StoredFileResult> {
    if (record.status === STORED_FILE_STATUS.REJECTED) throw objectNotFound(record.sourceKey);

    const finalMeta = await this.storage.head(record.key, record.bucket);
    if (!finalMeta) {
      throw new DomainException({
        kind: 'conflict',
        // A concurrent confirm is still finalizing; the retry that follows can win.
        permanent: false,
        code: ERROR_CODES.UPLOAD_IN_PROGRESS,
        title: I18N_KEYS.common.conflict,
        violations: [
          {
            path: 'key',
            code: 'upload_in_progress',
            message: 'Upload confirmation is still in progress; retry shortly',
          },
        ],
      });
    }

    if (record.status === STORED_FILE_STATUS.FINALIZING) {
      await this.files.transition(
        record.id,
        STORED_FILE_STATUS.FINALIZING,
        STORED_FILE_STATUS.VERIFYING,
      );
    }

    if (record.isQuarantined()) {
      await this.verification.dispatch({
        key: record.key,
        declaredContentType: record.contentType,
        bucket: record.bucket,
        correlationId,
      });
    }

    const url = record.isQuarantined()
      ? undefined
      : await this.storage.getSignedUrl(record.key, undefined, record.bucket);
    return { id: record.id, key: record.key, url, bucket: record.bucket, size: record.size };
  }

  // A failed delete must not mask the validation error that triggered it, but swallowing it
  // silently orphans the object until lifecycle expiry — so it is surfaced for observability.
  private async safeDelete(key: string): Promise<void> {
    await this.storage.delete(key).catch((err: unknown) => {
      this.logger.warn(
        { err, key },
        'cleanup delete failed — object orphaned until lifecycle expiry',
      );
    });
  }

  // Storage failing to copy is an infrastructure fault, not a rule the caller broke: it must stay a
  // redacted 500 rather than become a DomainException, whose kinds are all client-correctable.
  private commitFailed(): Error {
    return new Error('Failed to finalize upload');
  }
}
