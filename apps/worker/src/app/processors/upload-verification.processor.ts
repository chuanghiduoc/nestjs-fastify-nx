import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { QUEUE_NAMES, positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { VerifyUploadCommand } from '@nestjs-fastify-nx/modules-upload';
import type { WorkerEnvConfig } from '../../config/env.validation';
import { applyWorkerConcurrency } from './apply-worker-concurrency';

export interface UploadVerificationPayload {
  key: string;
  declaredContentType: string;
  bucket: string;
  // Propagated from the originating /upload/confirm request so worker logs correlate with it.
  correlationId?: string;
}

// Seed only — decorator options evaluate before ConfigModule parses .env; see applyWorkerConcurrency.
const UPLOAD_CONCURRENCY = positiveIntEnv('WORKER_UPLOAD_CONCURRENCY', 5);

// Transport adapter only: the stored-file state machine, the signature check and the scan sequence
// live in VerifyUploadCommand, which the api's confirm flow shares.
@Processor(QUEUE_NAMES.UPLOAD_VERIFICATION, { concurrency: UPLOAD_CONCURRENCY })
export class UploadVerificationProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(UploadVerificationProcessor.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly config: ConfigService<WorkerEnvConfig, true>,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    applyWorkerConcurrency(
      this,
      this.config.get('WORKER_UPLOAD_CONCURRENCY', { infer: true }),
      this.logger,
    );
  }

  async process(job: Job<UploadVerificationPayload>): Promise<void> {
    const { key, declaredContentType, bucket, correlationId } = job.data;

    await this.commandBus.execute(
      new VerifyUploadCommand(key, declaredContentType, bucket, correlationId),
    );
  }
}
