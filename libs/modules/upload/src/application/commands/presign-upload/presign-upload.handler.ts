import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { generateId } from '@nestjs-fastify-nx/shared';
import {
  STORAGE_PORT,
  type PresignedUpload,
  type StoragePort,
} from '@nestjs-fastify-nx/infra-storage';
import { extensionForMimeType } from '../../../domain/entities/stored-file.entity';
import { UPLOAD_LIMITS, type UploadLimits } from '../../upload-limits';
import { PresignUploadCommand } from './presign-upload.command';

@CommandHandler(PresignUploadCommand)
export class PresignUploadHandler implements ICommandHandler<
  PresignUploadCommand,
  PresignedUpload
> {
  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(UPLOAD_LIMITS) private readonly limits: UploadLimits,
  ) {}

  // `async` matters: a rule violation must reject the returned promise, not throw synchronously out
  // of the bus dispatch, where callers awaiting execute() would never see it as a rejection.
  async execute(command: PresignUploadCommand): Promise<PresignedUpload> {
    const extension = extensionForMimeType(command.contentType);
    // The user id in the prefix makes the otherwise bearer-like storage key tenant-scoped.
    const key = `uploads/${command.userId}/${generateId()}.${extension}`;

    return this.storage.presignUpload(key, {
      contentType: command.contentType,
      maxBytes: this.limits.maxFileBytes,
      expiresInSeconds: this.limits.presignExpiresSeconds,
    });
  }
}
