import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import {
  ALLOWED_MIME_TYPES,
  detectFileType,
  MIME_EXTENSIONS,
  STORED_FILE_STATUS,
  type StoredFileStatus,
} from '@nestjs-fastify-nx/shared';

export interface StoredFileProps {
  id: string;
  userId: string;
  sourceKey: string;
  key: string;
  bucket: string;
  contentType: string;
  size: number;
  etag: string;
  status: StoredFileStatus;
}

// FINALIZING → VERIFYING → READY | REJECTED. Every write in the flow is a compare-and-set on the
// expected status, so a duplicate confirm or a retried verify job can never skip a step or resurrect
// a rejected object.
const ALLOWED_TRANSITIONS: Record<StoredFileStatus, readonly StoredFileStatus[]> = {
  [STORED_FILE_STATUS.FINALIZING]: [STORED_FILE_STATUS.VERIFYING, STORED_FILE_STATUS.REJECTED],
  [STORED_FILE_STATUS.VERIFYING]: [STORED_FILE_STATUS.READY, STORED_FILE_STATUS.REJECTED],
  [STORED_FILE_STATUS.READY]: [],
  [STORED_FILE_STATUS.REJECTED]: [],
};

export class StoredFile {
  private constructor(private readonly props: StoredFileProps) {}

  static create(props: StoredFileProps): StoredFile {
    return new StoredFile(props);
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get sourceKey(): string {
    return this.props.sourceKey;
  }
  get key(): string {
    return this.props.key;
  }
  get bucket(): string {
    return this.props.bucket;
  }
  get contentType(): string {
    return this.props.contentType;
  }
  get size(): number {
    return this.props.size;
  }
  get etag(): string {
    return this.props.etag;
  }
  get status(): StoredFileStatus {
    return this.props.status;
  }

  canTransitionTo(next: StoredFileStatus): boolean {
    return ALLOWED_TRANSITIONS[this.props.status].includes(next);
  }

  isQuarantined(): boolean {
    return this.props.status !== STORED_FILE_STATUS.READY;
  }
}

/** The extension the storage key must carry for a mime type the allow-list accepts. */
export function extensionForMimeType(contentType: string): string {
  const extension = MIME_EXTENSIONS.get(contentType);
  if (!extension) {
    throw new DomainException({
      kind: 'validation',
      code: ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED,
      title: I18N_KEYS.common.unprocessable_entity,
      messageKey: I18N_KEYS.errors.upload.mime_not_allowed,
      args: { contentType },
      violations: [
        {
          path: 'contentType',
          code: 'mime_not_allowed',
          message: `Mime type "${contentType}" is not allowed`,
          messageKey: I18N_KEYS.errors.upload.mime_not_allowed,
        },
      ],
    });
  }
  return extension;
}

export function assertMimeAllowed(contentType: string): void {
  if (ALLOWED_MIME_TYPES.has(contentType)) return;
  throw new DomainException({
    kind: 'validation',
    code: ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED,
    title: I18N_KEYS.common.unprocessable_entity,
    messageKey: I18N_KEYS.errors.upload.mime_not_allowed,
    args: { contentType },
    violations: [
      {
        path: 'key',
        code: 'mime_not_allowed',
        message: `Mime type "${contentType}" is not allowed`,
        messageKey: I18N_KEYS.errors.upload.mime_not_allowed,
      },
    ],
  });
}

export function assertSizeWithinLimit(size: number, maxBytes: number): void {
  if (size > 0 && size <= maxBytes) return;
  throw new DomainException({
    kind: 'validation',
    code: ERROR_CODES.UPLOAD_SIZE_OUT_OF_RANGE,
    title: I18N_KEYS.common.unprocessable_entity,
    messageKey: I18N_KEYS.errors.upload.size_out_of_range,
    args: { size, max: maxBytes },
    violations: [
      {
        path: 'key',
        code: 'size_out_of_range',
        message: `Object size ${size} bytes is outside the allowed range (1..${maxBytes})`,
        messageKey: I18N_KEYS.errors.upload.size_out_of_range,
      },
    ],
  });
}

/**
 * The declared Content-Type is attacker-controlled: it is whatever the client asked the presign
 * policy to pin. Only the leading bytes prove what the object actually is.
 */
export function assertMagicBytesMatch(
  head: Buffer,
  declaredContentType: string,
  key: string,
): void {
  const detected = detectFileType(head);

  if (!detected) {
    throw new DomainException({
      kind: 'validation',
      code: ERROR_CODES.UPLOAD_MAGIC_BYTES_UNKNOWN,
      title: I18N_KEYS.common.unprocessable_entity,
      messageKey: I18N_KEYS.errors.upload.magic_bytes_unknown,
      args: { key },
      violations: [
        {
          path: 'key',
          code: 'magic_bytes_unknown',
          message: `Object at "${key}" has no recognized binary signature`,
          messageKey: I18N_KEYS.errors.upload.magic_bytes_unknown,
        },
      ],
    });
  }

  if (detected.mimeType !== declaredContentType) {
    throw new DomainException({
      kind: 'validation',
      code: ERROR_CODES.UPLOAD_MAGIC_BYTES_MISMATCH,
      title: I18N_KEYS.common.unprocessable_entity,
      messageKey: I18N_KEYS.errors.upload.magic_bytes_mismatch,
      args: { detected: detected.mimeType, declared: declaredContentType },
      violations: [
        {
          path: 'key',
          code: 'magic_bytes_mismatch',
          message: `Magic bytes indicate "${detected.mimeType}" but Content-Type is "${declaredContentType}"`,
          messageKey: I18N_KEYS.errors.upload.magic_bytes_mismatch,
        },
      ],
    });
  }
}

/** A key outside the caller's own prefix is reported as missing so object existence stays private. */
export function assertOwnsSourceKey(sourceKey: string, userId: string): void {
  if (sourceKey.startsWith(`uploads/${userId}/`)) return;
  throw objectNotFound(sourceKey);
}

export function objectNotFound(key: string): DomainException {
  return new DomainException({
    kind: 'not_found',
    // Generic: the 404 status already says everything a client can act on here.
    code: ERROR_CODES.NOT_FOUND,
    title: I18N_KEYS.common.not_found,
    messageKey: I18N_KEYS.errors.upload.object_not_found,
    args: { key },
    violations: [
      {
        path: 'key',
        code: 'object_not_found',
        message: `No object stored at "${key}"`,
        messageKey: I18N_KEYS.errors.upload.object_not_found,
      },
    ],
  });
}
