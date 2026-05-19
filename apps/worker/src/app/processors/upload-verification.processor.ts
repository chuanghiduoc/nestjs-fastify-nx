import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES, detectFileType, positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { STORAGE_PORT, type StoragePort } from '@nestjs-fastify-nx/infra-storage';

export interface UploadVerificationPayload {
  key: string;
  declaredContentType: string;
  bucket: string;
}

// 16 bytes is enough for every signature in libs/shared/src/lib/file-signature.ts
// (longest is PNG at 8 bytes). Reading less than the full object keeps S3
// egress flat regardless of upload size.
const MAGIC_BYTES_TO_READ = 16;

// Resolved once at module load — process.env is fully populated by the time
// NestJS evaluates class decorators.
const UPLOAD_CONCURRENCY = positiveIntEnv('WORKER_UPLOAD_CONCURRENCY', 5);

@Processor(QUEUE_NAMES.UPLOAD_VERIFICATION, { concurrency: UPLOAD_CONCURRENCY })
export class UploadVerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(UploadVerificationProcessor.name);

  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {
    super();
  }

  async process(job: Job<UploadVerificationPayload>): Promise<void> {
    const { key, declaredContentType, bucket } = job.data;

    const head = Buffer.from(await this.storage.readRange(key, MAGIC_BYTES_TO_READ, bucket));
    const detected = detectFileType(head);

    if (!detected) {
      this.logger.warn(
        { key, declaredContentType },
        `verify-magic-bytes: no signature match — deleting object as unrecognized binary`,
      );
      await this.storage.delete(key, bucket).catch(() => undefined);
      return;
    }

    if (detected.mimeType !== declaredContentType) {
      this.logger.warn(
        { key, declaredContentType, detected: detected.mimeType },
        `verify-magic-bytes: MIME mismatch — deleting tampered upload`,
      );
      await this.storage.delete(key, bucket).catch(() => undefined);
      return;
    }

    this.logger.log(`verify-magic-bytes: ${key} matches declared ${declaredContentType}`);
  }
}
