import { Module, type Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '@nestjs-fastify-nx/infra-storage';
import { DatabaseModule } from '@nestjs-fastify-nx/infra-database';
import { positiveIntEnv, QUEUE_NAMES } from '@nestjs-fastify-nx/shared';
import { UploadController } from './presentation/controllers/upload.controller';
import { PresignUploadHandler } from './application/commands/presign-upload/presign-upload.handler';
import { ConfirmUploadHandler } from './application/commands/confirm-upload/confirm-upload.handler';
import { VerifyUploadHandler } from './application/commands/verify-upload/verify-upload.handler';
import { UPLOAD_VERIFICATION_DISPATCHER } from './application/ports/upload-verification.dispatcher';
import { UPLOAD_LIMITS, type UploadLimits } from './application/upload-limits';
import { STORED_FILE_REPOSITORY } from './domain/ports/stored-file-repository.port';
import { PrismaStoredFileRepository } from './infrastructure/repositories/prisma-stored-file.repository';
import { BullMqUploadVerificationDispatcher } from './infrastructure/dispatchers/bullmq-upload-verification.dispatcher';

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
// Covers every signature in file-signature.ts.
const MAGIC_BYTE_COUNT = 16;

const uploadLimitsProvider: Provider = {
  provide: UPLOAD_LIMITS,
  useFactory: (): UploadLimits => ({
    maxFileBytes: positiveIntEnv('UPLOAD_MAX_FILE_BYTES', DEFAULT_MAX_FILE_SIZE),
    presignExpiresSeconds: positiveIntEnv('UPLOAD_PRESIGN_EXPIRES_SECONDS', 300),
    magicByteCount: MAGIC_BYTE_COUNT,
  }),
};

const storedFileRepositoryProvider: Provider = {
  provide: STORED_FILE_REPOSITORY,
  useClass: PrismaStoredFileRepository,
};

// Shared by the api (which owns the HTTP surface) and the worker (which verifies), so the
// stored-file state machine has a single owner. The worker supplies its own scanner adapter and
// needs no queue producer, hence the two entry points below.
@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [uploadLimitsProvider, storedFileRepositoryProvider, VerifyUploadHandler],
  exports: [UPLOAD_LIMITS, STORED_FILE_REPOSITORY],
})
export class UploadVerificationModule {}

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
  ],
})
export class UploadModule {}
