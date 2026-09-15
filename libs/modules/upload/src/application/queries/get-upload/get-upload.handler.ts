import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AUTHORIZATION_PORT, type AuthorizationPort } from '@nestjs-fastify-nx/core';
import { PERMISSIONS, RESOURCE_TYPES } from '@nestjs-fastify-nx/shared';
import type { StoredFile } from '@nestjs-fastify-nx/infra-storage';
import { objectNotFound } from '../../../domain/entities/stored-file.entity';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepositoryPort,
} from '../../../domain/ports/stored-file-repository.port';
import { UploadPublicationService } from '../../upload-publication.service';
import { GetUploadQuery } from './get-upload.query';

@QueryHandler(GetUploadQuery)
export class GetUploadHandler implements IQueryHandler<GetUploadQuery, StoredFile> {
  constructor(
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepositoryPort,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
    private readonly publication: UploadPublicationService,
  ) {}

  async execute(query: GetUploadQuery): Promise<StoredFile> {
    const file = await this.files.findById(query.fileId);
    if (!file || file.isDeleted() || file.organizationId !== query.organizationId) {
      throw objectNotFound(query.fileId);
    }
    const decision = await this.authorization.check(
      { type: 'user', userId: query.userId, organizationId: query.organizationId },
      PERMISSIONS.FILE_READ,
      {
        type: RESOURCE_TYPES.FILE,
        id: file.id,
        organizationId: file.organizationId,
        ownerId: file.userId,
      },
    );
    if (!decision.allowed) throw objectNotFound(query.fileId);
    return this.publication.result(file);
  }
}
