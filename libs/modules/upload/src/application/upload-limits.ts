import { positiveIntEnv } from '@nestjs-fastify-nx/shared';

export const UPLOAD_LIMITS = Symbol('UPLOAD_LIMITS');

// Single source of truth for the presign policy cap, the confirm-time size check and the
// multipart upload handler's own cap, so every layer rejects at exactly the same threshold.
export const UPLOAD_DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

// Enough to cover every signature in file-signature.ts.
export const UPLOAD_MAGIC_BYTE_COUNT = 16;

export interface UploadLimits {
  readonly maxFileBytes: number;
  readonly presignExpiresSeconds: number;
  readonly magicByteCount: number;
  readonly malwareScanEnabled: boolean;
  readonly bucket: string;
}

export function readUploadLimits(): UploadLimits {
  return {
    maxFileBytes: positiveIntEnv('UPLOAD_MAX_FILE_BYTES', UPLOAD_DEFAULT_MAX_FILE_BYTES),
    presignExpiresSeconds: positiveIntEnv('UPLOAD_PRESIGN_EXPIRES_SECONDS', 300),
    magicByteCount: UPLOAD_MAGIC_BYTE_COUNT,
    malwareScanEnabled: process.env['MALWARE_SCANNER_ENABLED'] === 'true',
    bucket: process.env['STORAGE_BUCKET'] ?? 'uploads',
  };
}
