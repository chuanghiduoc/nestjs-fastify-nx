import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AUTHORIZATION_PORT, type AuthorizationPort } from '@nestjs-fastify-nx/core';
import { PERMISSIONS, RESOURCE_TYPES } from '@nestjs-fastify-nx/shared';
import { objectNotFound } from '../../../domain/entities/stored-file.entity';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../../../domain/ports/stored-file-repository.port';
import { DeleteUploadCommand } from './delete-upload.command';

@CommandHandler(DeleteUploadCommand)
export class DeleteUploadHandler implements ICommandHandler<DeleteUploadCommand, void> {
  private readonly logger = new Logger(DeleteUploadHandler.name);

  constructor(
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepositoryPort,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
  ) {}

  async execute(command: DeleteUploadCommand): Promise<void> {
    const file = await this.files.findById(command.fileId);
    if (!file) throw objectNotFound(command.fileId);

    // Decided here rather than by the route guard: the owner-scoped grant needs the resource, and
    // only this layer has loaded it. A denial answers 404, not 403 — a caller must not learn that
    // a file they cannot touch exists.
    const decision = await this.authorization.check(
      {
        type: 'user',
        userId: command.userId,
        organizationId: command.organizationId,
      },
      PERMISSIONS.FILE_DELETE,
      {
        type: RESOURCE_TYPES.FILE,
        id: file.id,
        organizationId: file.organizationId,
        ownerId: file.userId,
      },
    );
    if (!decision.allowed) throw objectNotFound(command.fileId);

    const deleted = await this.files.softDelete(command.fileId);
    if (!deleted) return;

    this.logger.log(
      { fileId: file.id, key: file.key, organizationId: file.organizationId },
      'Stored file soft-deleted',
    );
  }
}
