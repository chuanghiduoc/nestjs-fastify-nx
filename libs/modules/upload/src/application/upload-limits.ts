export const UPLOAD_LIMITS = Symbol('UPLOAD_LIMITS');

// UPLOAD_MAX_FILE_BYTES is the single source of truth for the presign policy cap and the
// confirm-time size check, so both layers reject at exactly the same threshold.
export interface UploadLimits {
  readonly maxFileBytes: number;
  readonly presignExpiresSeconds: number;
  /** Enough to cover every signature in file-signature.ts. */
  readonly magicByteCount: number;
}
