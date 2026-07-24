import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES, detectFileType, positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { STORAGE_PORT, type StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';

export interface UploadVerificationPayload {
  key: string;
  declaredContentType: string;
  bucket: string;
  // Propagated from the originating /upload/confirm request so worker logs correlate with it.
  correlationId?: string;
}

const MAGIC_BYTES_TO_READ = 16; // covers all signatures in file-signature.ts
const UPLOAD_CONCURRENCY = positiveIntEnv('WORKER_UPLOAD_CONCURRENCY', 5);

@Processor(QUEUE_NAMES.UPLOAD_VERIFICATION, { concurrency: UPLOAD_CONCURRENCY })
export class UploadVerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(UploadVerificationProcessor.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<UploadVerificationPayload>): Promise<void> {
    const { key, declaredContentType, bucket, correlationId } = job.data;

    const head = Buffer.from(await this.storage.readRange(key, MAGIC_BYTES_TO_READ, bucket));
    const detected = detectFileType(head);

    if (!detected) {
      this.logger.warn(
        { key, declaredContentType, correlationId },
        `verify-magic-bytes: no signature match — deleting object as unrecognized binary`,
      );
      await this.reject(key, bucket, 'Unrecognized binary signature');
      return;
    }

    if (detected.mimeType !== declaredContentType) {
      this.logger.warn(
        { key, declaredContentType, detected: detected.mimeType, correlationId },
        `verify-magic-bytes: MIME mismatch — deleting tampered upload`,
      );
      await this.reject(
        key,
        bucket,
        `MIME mismatch: declared=${declaredContentType} detected=${detected.mimeType}`,
      );
      return;
    }

    const result = await this.prisma.db.storedFile.updateMany({
      where: { key, status: STORED_FILE_STATUS.VERIFYING },
      data: { status: STORED_FILE_STATUS.READY, verifiedAt: new Date(), failureReason: null },
    });
    if (result.count === 0) {
      // Mirror reject()'s CAS guard: a duplicate/retried job — or a row already flipped or purged —
      // is a safe no-op. Log it as skipped rather than reporting a READY flip that never happened.
      this.logger.warn(
        { key, declaredContentType, correlationId },
        'verify-magic-bytes: ready-flip skipped — record not in VERIFYING state (already processed)',
      );
      return;
    }

    this.logger.log(
      { key, declaredContentType, correlationId },
      `verify-magic-bytes: ${key} matches declared ${declaredContentType}`,
    );
  }

  private async reject(key: string, bucket: string, failureReason: string): Promise<void> {
    // Mirror the success-path status guard: only flip VERIFYING → REJECTED. Without it, a
    // duplicate/retried job could re-reject and delete an object another execution already
    // marked READY (or already rejected+deleted), destroying a live file or double-deleting.
    const result = await this.prisma.db.storedFile.updateMany({
      where: { key, status: STORED_FILE_STATUS.VERIFYING },
      data: { status: STORED_FILE_STATUS.REJECTED, failureReason },
    });
    if (result.count === 0) {
      this.logger.warn(
        { key },
        'verify-magic-bytes: reject skipped — record not in VERIFYING state (already processed)',
      );
      return;
    }
    await this.storage.delete(key, bucket);
  }
}
