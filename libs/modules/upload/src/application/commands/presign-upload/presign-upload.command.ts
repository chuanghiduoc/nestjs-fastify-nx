import { Command } from '@nestjs/cqrs';
import type { PresignedUpload } from '@nestjs-fastify-nx/infra-storage';

export class PresignUploadCommand extends Command<PresignedUpload> {
  constructor(
    readonly userId: string,
    readonly contentType: string,
  ) {
    super();
  }
}
