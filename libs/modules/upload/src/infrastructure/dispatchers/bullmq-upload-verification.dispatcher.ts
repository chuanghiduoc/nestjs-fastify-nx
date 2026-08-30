import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { BULL_JOB_NAMES, QUEUE_NAMES, RETRIED_JOB_OPTIONS } from '@nestjs-fastify-nx/shared';
import type {
  UploadVerificationDispatcher,
  UploadVerificationRequest,
} from '../../application/ports/upload-verification.dispatcher';

export function verificationJobId(storageKey: string): string {
  // A delimiter replacement is not injective (`a/b_c` and `a_b/c` collide). Hash the complete
  // object key so retries deduplicate while distinct uploads can never share a BullMQ job id.
  return `verify__${createHash('sha256').update(storageKey).digest('hex')}`;
}

@Injectable()
export class BullMqUploadVerificationDispatcher implements UploadVerificationDispatcher {
  private readonly logger = new Logger(BullMqUploadVerificationDispatcher.name);

  constructor(@InjectQueue(QUEUE_NAMES.UPLOAD_VERIFICATION) private readonly queue: Queue) {}

  async dispatch(request: UploadVerificationRequest): Promise<void> {
    try {
      await this.queue.add(BULL_JOB_NAMES.VERIFY_MAGIC_BYTES, request, {
        jobId: verificationJobId(request.key),
        ...RETRIED_JOB_OPTIONS,
      });
    } catch (err) {
      this.logger.error({ err, key: request.key }, 'enqueue verify-magic-bytes failed');
      throw err;
    }
  }
}
