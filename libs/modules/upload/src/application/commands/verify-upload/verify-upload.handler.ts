import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { isDomainException } from '@nestjs-fastify-nx/core';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import { STORAGE_PORT, type StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { assertMagicBytesMatch } from '../../../domain/entities/stored-file.entity';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../../../domain/ports/stored-file-repository.port';
import {
  MALWARE_SCANNER_PORT,
  type MalwareScannerPort,
} from '../../../domain/ports/malware-scanner.port';
import { UPLOAD_LIMITS, type UploadLimits } from '../../upload-limits';
import { VerifyUploadCommand, type VerifyUploadOutcome } from './verify-upload.command';

@CommandHandler(VerifyUploadCommand)
export class VerifyUploadHandler implements ICommandHandler<
  VerifyUploadCommand,
  VerifyUploadOutcome
> {
  private readonly logger = new Logger(VerifyUploadHandler.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepositoryPort,
    @Inject(MALWARE_SCANNER_PORT) private readonly scanner: MalwareScannerPort,
    @Inject(UPLOAD_LIMITS) private readonly limits: UploadLimits,
  ) {}

  async execute(command: VerifyUploadCommand): Promise<VerifyUploadOutcome> {
    const { key, declaredContentType, bucket, correlationId } = command;

    // Buffer.from: an adapter may hand back a Uint8Array, and the signature table indexes bytes.
    const head = Buffer.from(await this.storage.readRange(key, this.limits.magicByteCount, bucket));
    try {
      assertMagicBytesMatch(head, declaredContentType, key);
    } catch (err) {
      const reason = isDomainException(err) ? err.code : 'signature check failed';
      this.logger.warn(
        { key, declaredContentType, correlationId, reason },
        'upload-verification: signature rejected — deleting object',
      );
      return this.reject(key, bucket, reason);
    }

    if ((await this.scanner.scan(await this.storage.read(key, bucket))) === 'infected') {
      this.logger.warn(
        { key, declaredContentType, correlationId },
        'upload-verification: infected object rejected and deleted',
      );
      return this.reject(key, bucket, 'Malware scan rejected the object');
    }

    const flipped = await this.files.transitionByKey(
      key,
      STORED_FILE_STATUS.VERIFYING,
      STORED_FILE_STATUS.READY,
      { verifiedAt: new Date(), failureReason: null },
    );
    if (!flipped) {
      // A duplicate or retried job — or a row already flipped or purged — is a safe no-op.
      this.logger.warn(
        { key, declaredContentType, correlationId },
        'upload-verification: ready-flip skipped — record not in VERIFYING state',
      );
      return 'skipped';
    }

    this.logger.log(
      { key, declaredContentType, correlationId },
      'upload-verification: passed signature and malware scans',
    );
    return 'verified';
  }

  // The object is deleted only after the row is claimed out of VERIFYING, so a duplicate job cannot
  // delete a file another execution already promoted to READY.
  private async reject(
    key: string,
    bucket: string,
    failureReason: string,
  ): Promise<'rejected' | 'skipped'> {
    const claimed = await this.files.transitionByKey(
      key,
      STORED_FILE_STATUS.VERIFYING,
      STORED_FILE_STATUS.REJECTED,
      { failureReason },
    );
    if (!claimed) {
      this.logger.warn(
        { key },
        'upload-verification: reject skipped — record not in VERIFYING state',
      );
      return 'skipped';
    }

    await this.storage.delete(key, bucket);
    return 'rejected';
  }
}
