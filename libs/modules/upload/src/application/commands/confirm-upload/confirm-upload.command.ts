import { Command } from '@nestjs/cqrs';
import type { StoredFile } from '@nestjs-fastify-nx/infra-storage';

export class ConfirmUploadCommand extends Command<StoredFile> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
    readonly sourceKey: string,
    // Carried onto the verification job so worker logs tie back to the originating request.
    readonly correlationId?: string,
  ) {
    super();
  }
}
