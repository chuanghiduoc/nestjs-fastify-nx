import { Module, type DynamicModule, type ModuleMetadata, type Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { UploadController } from './presentation/controllers/upload.controller';
import { PresignUploadHandler } from './application/commands/presign-upload/presign-upload.handler';
import { ConfirmUploadHandler } from './application/commands/confirm-upload/confirm-upload.handler';
import { DeleteUploadHandler } from './application/commands/delete-upload/delete-upload.handler';
import { VerifyUploadHandler } from './application/commands/verify-upload/verify-upload.handler';
import { UPLOAD_VERIFICATION_DISPATCHER } from './application/ports/upload-verification.dispatcher';
import { UPLOAD_LIMITS, readUploadLimits } from './application/upload-limits';
import { STORED_FILE_REPOSITORY } from './domain/ports/stored-file-repository.port';
import { PrismaStoredFileRepository } from './infrastructure/repositories/prisma-stored-file.repository';
import { BullMqUploadVerificationDispatcher } from './infrastructure/dispatchers/bullmq-upload-verification.dispatcher';
import { UploadPublicationService } from './application/upload-publication.service';
import { UploadFilesHandler } from './application/commands/upload-files/upload-files.handler';
import { GetUploadHandler } from './application/queries/get-upload/get-upload.handler';

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
