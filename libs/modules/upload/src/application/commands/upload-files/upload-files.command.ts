import { Command } from '@nestjs/cqrs';
import type { StoredFile } from '@nestjs-fastify-nx/infra-storage';

export interface MultipartUploadFile {
  readonly filepath: string;
  readonly contentType: string;
  readonly size: number;
  readonly digest: string;
}

export interface UploadFilesOptions {
  readonly organizationId: string;
  readonly userId: string;
  readonly files: readonly MultipartUploadFile[];
  readonly signal: AbortSignal;
  readonly correlationId?: string;
}

export class UploadFilesCommand extends Command<StoredFile[]> {
  constructor(readonly options: UploadFilesOptions) {
    super();
  }
}
