import { Module, type DynamicModule, type ModuleMetadata, type Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { UploadController } from './upload.controller';
import { PresignUploadHandler } from './presign-upload';
import { ConfirmUploadHandler } from './confirm-upload';
import { DeleteUploadHandler } from './delete-upload';
import { VerifyUploadHandler } from './verify-upload';
import { UPLOAD_VERIFICATION_DISPATCHER } from './upload-verification.dispatcher';
import { UPLOAD_LIMITS, readUploadLimits } from './upload-limits';
import { STORED_FILE_REPOSITORY } from './stored-file-repository.port';
import { PrismaStoredFileRepository } from './prisma-stored-file.repository';
import { BullMqUploadVerificationDispatcher } from './bullmq-upload-verification.dispatcher';
import { UploadPublicationService } from './upload-publication.service';
import { UploadFilesHandler } from './upload-files';
import { GetUploadHandler } from './get-upload';

const uploadLimitsProvider: Provider = {
  provide: UPLOAD_LIMITS,
  useFactory: readUploadLimits,
};

const storedFileRepositoryProvider: Provider = {
  provide: STORED_FILE_REPOSITORY,
  useClass: PrismaStoredFileRepository,
};

export interface UploadVerificationModuleOptions {
  /**
   * Module(s) exporting MALWARE_SCANNER_PORT. It is dynamic because the scanner is process-specific
   * (the worker talks to a local clamd) — and because a provider declared in the consuming app's own
   * `providers` is NOT visible inside this module, so wiring it that way fails at boot with
   * UnknownDependenciesException rather than at compile time.
   */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
}

// Shared by the api (which owns the HTTP surface) and the worker (which verifies), so the
// stored-file state machine has a single owner.
@Module({})
export class UploadVerificationModule {
  static forRoot(options: UploadVerificationModuleOptions): DynamicModule {
    return {
      module: UploadVerificationModule,
      imports: [DatabaseModule, StorageModule, ...options.imports],
      providers: [uploadLimitsProvider, storedFileRepositoryProvider, VerifyUploadHandler],
      exports: [UPLOAD_LIMITS, STORED_FILE_REPOSITORY],
    };
  }
}

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.UPLOAD_VERIFICATION }),
  ],
  controllers: [UploadController],
  providers: [
    uploadLimitsProvider,
    storedFileRepositoryProvider,
    { provide: UPLOAD_VERIFICATION_DISPATCHER, useClass: BullMqUploadVerificationDispatcher },
    PresignUploadHandler,
    ConfirmUploadHandler,
    DeleteUploadHandler,
    UploadPublicationService,
    UploadFilesHandler,
    GetUploadHandler,
  ],
})
export class UploadModule {}
