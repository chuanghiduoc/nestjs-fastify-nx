import { Inject, Injectable, Logger } from '@nestjs/common';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import {
  STORAGE_PORT,
  type StoragePort,
  type StoredFile as StoredFileResult,
} from '@nestjs-fastify-nx/infra-storage';
import { StoredFile } from '../domain/entities/stored-file.entity';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../domain/ports/stored-file-repository.port';
import {
  UPLOAD_VERIFICATION_DISPATCHER,
  type UploadVerificationDispatcher,
} from './ports/upload-verification.dispatcher';

@Injectable()
export class UploadPublicationService {
  private readonly logger = new Logger(UploadPublicationService.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepositoryPort,
    @Inject(UPLOAD_VERIFICATION_DISPATCHER)
    private readonly verification: UploadVerificationDispatcher,
  ) {}

  async result(file: StoredFile, correlationId?: string): Promise<StoredFileResult> {
    if (file.status === STORED_FILE_STATUS.VERIFYING) {
      await this.verification
        .dispatch({
          key: file.key,
          bucket: file.bucket,
          declaredContentType: file.contentType,
          correlationId,
        })
        .catch((err: unknown) => {
          this.logger.error(
            { err, fileId: file.id },
            'Upload verification enqueue failed; status polling will retry',
          );
        });
    }
    return {
      id: file.id,
      key: file.key,
      bucket: file.bucket,
      size: file.size,
      status: file.status,
      url:
        file.status === STORED_FILE_STATUS.READY
          ? await this.storage.getSignedUrl(file.key, undefined, file.bucket)
          : undefined,
    };
  }

  async loadResult(id: string, correlationId?: string): Promise<StoredFileResult> {
    const file = await this.files.findById(id);
    if (!file || file.isDeleted()) throw new Error('Stored file disappeared before publication');
    return this.result(file, correlationId);
  }
}
