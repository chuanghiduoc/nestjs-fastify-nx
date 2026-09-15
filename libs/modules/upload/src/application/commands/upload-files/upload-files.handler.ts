import { createReadStream } from 'node:fs';
import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { generateId, STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import {
  STORAGE_PORT,
  type StoragePort,
  type StoredFile as StoredFileResult,
} from '@nestjs-fastify-nx/infra-storage';
import {
  StoredFile,
  extensionForMimeType,
  type StoredFileProps,
} from '../../../domain/entities/stored-file.entity';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../../../domain/ports/stored-file-repository.port';
import { UPLOAD_LIMITS, type UploadLimits } from '../../upload-limits';
import { UploadFilesCommand, type MultipartUploadFile } from './upload-files.command';
import { UploadPublicationService } from '../../upload-publication.service';

@CommandHandler(UploadFilesCommand)
export class UploadFilesHandler implements ICommandHandler<UploadFilesCommand, StoredFileResult[]> {
  private readonly logger = new Logger(UploadFilesHandler.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepositoryPort,
    @Inject(UPLOAD_LIMITS) private readonly limits: UploadLimits,
    private readonly publication: UploadPublicationService,
  ) {}

  async execute(command: UploadFilesCommand): Promise<StoredFileResult[]> {
    const { options } = command;
    options.signal.throwIfAborted();
    const prepared = options.files.map((file) => ({
      file,
      props: this.prepare(command, file),
    }));
    await this.files.createBatch(prepared.map(({ props }) => props));
    try {
      for (const { file, props } of prepared) {
        options.signal.throwIfAborted();
        await this.storage.uploadStream(props.key, createReadStream(file.filepath), {
          bucket: props.bucket,
          contentType: props.contentType,
          size: props.size,
          signal: options.signal,
        });
      }
      options.signal.throwIfAborted();
    } catch (err) {
      await this.cleanup(prepared.map(({ props }) => props));
      throw err;
    }
    const status = this.limits.malwareScanEnabled
      ? STORED_FILE_STATUS.VERIFYING
      : STORED_FILE_STATUS.READY;
    await this.files.publishBatch(
      prepared.map(({ props }) => props.id),
      status,
    );
    return Promise.all(
      prepared.map(({ props }) =>
        this.publication.result(StoredFile.create({ ...props, status }), options.correlationId),
      ),
    );
  }

  private prepare(command: UploadFilesCommand, file: MultipartUploadFile): StoredFileProps {
    const id = generateId();
    const key = `files/${command.options.userId}/${id}.${extensionForMimeType(file.contentType)}`;
    return {
      id,
      organizationId: command.options.organizationId,
      userId: command.options.userId,
      sourceKey: key,
      key,
      bucket: this.limits.bucket,
      contentType: file.contentType,
      size: file.size,
      etag: file.digest,
      status: STORED_FILE_STATUS.FINALIZING,
    };
  }

  private async cleanup(files: readonly StoredFileProps[]): Promise<void> {
    for (const file of files) {
      try {
        await this.storage.delete(file.key, file.bucket);
        await this.files.deleteIfStatus(file.id, STORED_FILE_STATUS.FINALIZING);
      } catch (err) {
        this.logger.error({ err, fileId: file.id }, 'Upload batch cleanup failed');
      }
    }
  }
}
