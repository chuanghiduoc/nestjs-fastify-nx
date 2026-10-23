import type { Logger } from '@nestjs/common';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';

export interface StorageFailureContract {
  readonly code: string;
  readonly messageKey: string;
  readonly message: string;
  readonly log: string;
}

export const STORAGE_FAILURES = {
  upload: {
    code: ERROR_CODES.STORAGE_UPLOAD_FAILED,
    messageKey: I18N_KEYS.errors.storage.upload_failed,
    message: 'Storage upload failed',
    log: 'storage upload failed',
  },
  presign: {
    code: ERROR_CODES.STORAGE_PRESIGN_FAILED,
    messageKey: I18N_KEYS.errors.storage.presign_failed,
    message: 'Storage presign failed',
    log: 'storage presign upload failed',
  },
  head: {
    code: ERROR_CODES.STORAGE_HEAD_FAILED,
    messageKey: I18N_KEYS.errors.storage.head_failed,
    message: 'Storage head failed',
    log: 'storage head failed',
  },
  signedUrl: {
    code: ERROR_CODES.STORAGE_SIGNED_URL_FAILED,
    messageKey: I18N_KEYS.errors.storage.signed_url_failed,
    message: 'Storage signed URL generation failed',
    log: 'storage getSignedUrl failed',
  },
  delete: {
    code: ERROR_CODES.STORAGE_DELETE_FAILED,
    messageKey: I18N_KEYS.errors.storage.delete_failed,
    message: 'Storage delete failed',
    log: 'storage delete failed',
  },
  finalize: {
    code: ERROR_CODES.STORAGE_FINALIZE_FAILED,
    messageKey: I18N_KEYS.errors.storage.commit_failed,
    message: 'Storage finalize failed; retry confirmation',
    log: 'storage finalize copy failed',
  },
  readRange: {
    code: ERROR_CODES.STORAGE_READ_FAILED,
    messageKey: I18N_KEYS.errors.storage.read_range_failed,
    message: 'Storage readRange failed',
    log: 'storage readRange failed',
  },
  readStream: {
    code: ERROR_CODES.STORAGE_READ_FAILED,
    messageKey: I18N_KEYS.errors.storage.read_range_failed,
    message: 'Storage readStream failed',
    log: 'storage readStream failed',
  },
} as const satisfies Record<string, StorageFailureContract>;

export function storageFailure(
  logger: Logger,
  failure: StorageFailureContract,
  ctx: Record<string, unknown>,
  err: unknown,
): DomainException {
  logger.error({ err, ...ctx }, failure.log);
  return new DomainException({
    kind: 'unavailable',
    code: failure.code,
    messageKey: failure.messageKey,
    violations: [
      {
        path: 'storage',
        code: failure.code,
        message: failure.message,
        messageKey: failure.messageKey,
      },
    ],
  });
}
