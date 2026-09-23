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
  type StoredFileProps,
} from '../../../domain/entities/stored-file.entity';
import { readHeadAndAssertMagicBytes } from '../../ports/read-magic-bytes';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../../../domain/ports/stored-file-repository.port';
import { UPLOAD_LIMITS, type UploadLimits } from '../../upload-limits';
import { UploadPublicationService } from '../../upload-publication.service';
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
    private readonly publication: UploadPublicationService,
    @Inject(UPLOAD_LIMITS) private readonly limits: UploadLimits,
  ) {}

  async execute(command: ConfirmUploadCommand): Promise<StoredFileResult> {
    // Ownership is checked before any storage call so a cross-user key never reaches S3.
    assertOwnsSourceKey(command.sourceKey, command.userId);

    const existing = await this.files.findBySourceKey(command.sourceKey);
    if (existing) {
      if (
        existing.organizationId !== command.organizationId ||
        existing.userId !== command.userId
      ) {
        throw objectNotFound(command.sourceKey);
      }
      return this.recoverExisting(existing, command.correlationId);
    }

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
    const props: StoredFileProps = {
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
    };

    const outcome = await this.files.create(props);
    if (outcome === 'duplicate') {
      const concurrent = await this.files.findBySourceKey(command.sourceKey);
      if (concurrent) return this.recoverExisting(concurrent, command.correlationId);
      throw this.commitFailed();
    }

    try {
      await this.storage.finalize(command.sourceKey, finalKey, meta.etag, meta.bucket);
    } catch (err) {
      await this.files
        .deleteIfStatus(fileId, STORED_FILE_STATUS.FINALIZING)
        .catch((cleanupError: unknown) => {
          this.logger.error(
            { err: cleanupError, fileId },
            'Failed to remove unfinished upload row',
          );
        });
      this.logger.error(
        { err, sourceKey: command.sourceKey, finalKey },
        'upload finalize failed — staging object remains lifecycle-managed',
      );
      throw this.commitFailed();
    }

    return this.completeFinalizing(StoredFile.create(props), command.correlationId);
  }

  private async recoverExisting(
    record: StoredFile,
    correlationId?: string,
  ): Promise<StoredFileResult> {
    if (record.status === STORED_FILE_STATUS.REJECTED) throw objectNotFound(record.sourceKey);

    if (record.status !== STORED_FILE_STATUS.FINALIZING) {
      return this.publication.result(record, correlationId);
    }

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

    return this.completeFinalizing(record, correlationId);
  }

  private async completeFinalizing(
    record: StoredFile,
    correlationId?: string,
  ): Promise<StoredFileResult> {
    if (!this.limits.malwareScanEnabled) {
      try {
        await readHeadAndAssertMagicBytes(
          { storage: this.storage, limits: this.limits },
          record.key,
          record.contentType,
          record.bucket,
        );
      } catch (err) {
        if (isPolicyViolation(err)) {
          const rejected = await this.files.transition(
            record.id,
            STORED_FILE_STATUS.FINALIZING,
            STORED_FILE_STATUS.REJECTED,
          );
          if (rejected) await this.storage.delete(record.key, record.bucket);
        }
        throw err;
      }
    }
    const status = this.limits.malwareScanEnabled
      ? STORED_FILE_STATUS.VERIFYING
      : STORED_FILE_STATUS.READY;
    const transitioned = await this.files.transition(
      record.id,
      STORED_FILE_STATUS.FINALIZING,
      status,
    );
    if (!transitioned) {
      const current = await this.files.findById(record.id);
      if (
        !current ||
        current.status === STORED_FILE_STATUS.FINALIZING ||
        current.status === STORED_FILE_STATUS.REJECTED
      ) {
        throw this.commitFailed();
      }
      return this.publication.result(current, correlationId);
    }
    return this.publication.result(record.withStatus(status), correlationId);
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
