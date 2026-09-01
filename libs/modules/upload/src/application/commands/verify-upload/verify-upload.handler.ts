import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { isDomainException } from '@nestjs-fastify-nx/core';
import { MALWARE_SCAN_OUTCOME, STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import { STORAGE_PORT, type StoragePort } from '@nestjs-fastify-nx/infra-storage';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../../../domain/ports/stored-file-repository.port';
import {
  MALWARE_SCANNER_PORT,
  type MalwareScannerPort,
} from '../../../domain/ports/malware-scanner.port';
import { UPLOAD_LIMITS, type UploadLimits } from '../../upload-limits';
import { readHeadAndAssertMagicBytes } from '../../ports/read-magic-bytes';
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

    try {
      await readHeadAndAssertMagicBytes(
        { storage: this.storage, limits: this.limits },
        key,
        declaredContentType,
        bucket,
      );
    } catch (err) {
      if (!isDomainException(err) || err.kind !== 'validation') throw err;
      const reason = err.code;
      this.logger.warn(
        { key, declaredContentType, correlationId, reason },
        'upload-verification: signature rejected — deleting object',
      );
      return this.reject(key, bucket, reason);
    }

    // Streamed, not read into a Buffer: an object here can be tens of gigabytes, and one job
    // materialising all of it would take the worker down with it. The size goes along so a scanner
    // that cannot handle the object says so before the transfer starts.
    const meta = await this.storage.head(key, bucket);
    const verdict = await this.scanner.scan(await this.storage.readStream(key, bucket), {
      sizeBytes: meta?.size,
    });
    if (verdict === 'infected') {
      this.logger.warn(
        { key, declaredContentType, correlationId },
        'upload-verification: infected object rejected and deleted',
      );
      return this.reject(key, bucket, 'Malware scan rejected the object');
    }

    // ClamAV cannot scan past its own 2 GiB per-file ceiling. The object is published anyway, but
    // the row records that nothing actually inspected it — a silent READY would claim otherwise.
    if (verdict === 'unscannable') {
      this.logger.warn(
        { key, declaredContentType, correlationId },
        'upload-verification: object exceeds the scanner limit — publishing unscanned',
      );
    }

    const flipped = await this.files.transitionByKey(
      key,
      STORED_FILE_STATUS.VERIFYING,
      STORED_FILE_STATUS.READY,
      {
        verifiedAt: new Date(),
        failureReason: null,
        scanOutcome:
          verdict === 'unscannable'
            ? MALWARE_SCAN_OUTCOME.SKIPPED_TOO_LARGE
            : MALWARE_SCAN_OUTCOME.CLEAN,
      },
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
      const record = await this.files.findByKey(key);
      if (record?.status === STORED_FILE_STATUS.REJECTED) {
        await this.storage.delete(key, bucket);
        return 'rejected';
      }
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
