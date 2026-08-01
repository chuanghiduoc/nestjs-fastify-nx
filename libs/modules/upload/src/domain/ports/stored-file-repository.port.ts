import type { MalwareScanOutcome, StoredFileStatus } from '@nestjs-fastify-nx/shared';
import type { StoredFile, StoredFileProps } from '../entities/stored-file.entity';

export const STORED_FILE_REPOSITORY = Symbol('STORED_FILE_REPOSITORY');

export interface StoredFileTransitionFields {
  verifiedAt?: Date;
  failureReason?: string | null;
  scanOutcome?: MalwareScanOutcome;
}

export interface StoredFileRepositoryPort {
  findBySourceKey(sourceKey: string): Promise<StoredFile | null>;
  findByKey(key: string): Promise<StoredFile | null>;
  /** Rejects with a duplicate-key error the caller can recover from when sourceKey already exists. */
  create(props: StoredFileProps): Promise<void>;
  /**
   * Compare-and-set: applies the change only while the row still holds `from`. Returns false when
   * another execution already moved it, which is what makes a duplicate confirm or a retried verify
   * job a safe no-op instead of a double side effect.
   */
  transition(
    id: string,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean>;
  transitionByKey(
    key: string,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean>;
  deleteIfStatus(id: string, status: StoredFileStatus): Promise<void>;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}
