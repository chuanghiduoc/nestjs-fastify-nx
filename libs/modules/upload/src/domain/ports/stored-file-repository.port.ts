import type { MalwareScanOutcome, StoredFileStatus } from '@nestjs-fastify-nx/shared';
import type { StoredFile, StoredFileProps } from '../entities/stored-file.entity';

export const STORED_FILE_REPOSITORY = Symbol('STORED_FILE_REPOSITORY');

export interface StoredFileTransitionFields {
  verifiedAt?: Date;
  failureReason?: string | null;
  scanOutcome?: MalwareScanOutcome;
}

export type StoredFileCreateOutcome = 'created' | 'duplicate';

export interface StoredFileRepositoryPort {
  createBatch(props: readonly StoredFileProps[]): Promise<void>;
  publishBatch(ids: readonly string[], status: 'READY' | 'VERIFYING'): Promise<void>;
  findBySourceKey(sourceKey: string): Promise<StoredFile | null>;
  findByKey(key: string): Promise<StoredFile | null>;
  findById(id: string): Promise<StoredFile | null>;
  create(props: StoredFileProps): Promise<StoredFileCreateOutcome>;
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
  /**
   * Compare-and-set soft delete: succeeds only while the row is still live, so a duplicate
   * DELETE is a no-op rather than moving the retention clock forward.
   */
  softDelete(id: string): Promise<boolean>;
}
