import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { objectNotFound } from '../../../domain/entities/stored-file.entity';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../../../domain/ports/stored-file-repository.port';
import { DeleteUploadCommand } from './delete-upload.command';

@CommandHandler(DeleteUploadCommand)
export class DeleteUploadHandler implements ICommandHandler<DeleteUploadCommand, void> {
  private readonly logger = new Logger(DeleteUploadHandler.name);

  constructor(@Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepositoryPort) {}

  async execute(command: DeleteUploadCommand): Promise<void> {
    const file = await this.files.findById(command.fileId);

    // A file owned by another member of the same organization answers 404, not 403: the caller
    // must not learn it exists.
    if (
      !file ||
      file.organizationId !== command.organizationId ||
      !file.isOwnedBy(command.userId)
    ) {
      throw objectNotFound(command.fileId);
    }

    const deleted = await this.files.softDelete(command.fileId);
    if (!deleted) return;

    this.logger.log(
      { fileId: file.id, key: file.key, organizationId: file.organizationId },
      'Stored file soft-deleted',
    );
  }
}
