import { Query } from '@nestjs/cqrs';
import type { StoredFile } from '@nestjs-fastify-nx/infra-storage';

export class GetUploadQuery extends Query<StoredFile> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
    readonly fileId: string,
  ) {
    super();
  }
}
