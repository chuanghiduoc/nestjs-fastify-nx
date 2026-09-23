import { Injectable } from '@nestjs/common';
import { PrismaService, type TransactionClient } from '@nestjs-fastify-nx/infra-database';
import { STORED_FILE_STATUS, type StoredFileStatus } from '@nestjs-fastify-nx/shared';
import { StoredFile, type StoredFileProps } from '../../domain/entities/stored-file.entity';
import type {
  StoredFileCreateOutcome,
  StoredFileRepositoryPort,
  StoredFileTransitionFields,
} from '../../domain/ports/stored-file-repository.port';

interface StoredFileRow {
  id: string;
  organizationId: string;
  userId: string;
  sourceKey: string;
  key: string;
  bucket: string;
  contentType: string;
  size: number;
  etag: string;
  status: string;
}

type StoredFileSelector = { id: string } | { key: string };

const PRISMA_UNIQUE_CONSTRAINT_CODE = 'P2002';

function isUniqueConstraintViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === PRISMA_UNIQUE_CONSTRAINT_CODE;
}

// Quarantining an in-flight upload must reach the row even after the owner soft-deleted it,
// otherwise the infected bytes sit in the bucket until the retention purge. Restricted to the two
// in-flight sources so no other transition can bypass the soft-delete predicate.
const REJECTABLE_FROM_STATUSES: readonly StoredFileStatus[] = [
  STORED_FILE_STATUS.FINALIZING,
  STORED_FILE_STATUS.VERIFYING,
];

function matchesSoftDeleted(from: StoredFileStatus, to: StoredFileStatus): boolean {
  return to === STORED_FILE_STATUS.REJECTED && REJECTABLE_FROM_STATUSES.includes(from);
}

@Injectable()
export class PrismaStoredFileRepository implements StoredFileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  private run<R>(
    fn: (client: TransactionClient) => Promise<R>,
    options: { readOnly: boolean },
  ): Promise<R> {
    const joined = options.readOnly
      ? (this.prisma.currentTransaction ?? this.prisma.currentReadTransaction)
      : this.prisma.currentTransaction;
    if (joined) return fn(joined);
    if (!this.prisma.hasTenantContext) {
      return fn(options.readOnly ? this.prisma.dbRead : this.prisma.db);
    }
    return this.prisma.withTenantContext(fn, { readOnly: options.readOnly });
  }

  private async findOne(
    where: { sourceKey: string } | { key: string } | { id: string },
  ): Promise<StoredFile | null> {
    const row = await this.run(
      (client) => client.storedFile.findFirst({ where: { ...where, deletedAt: null } }),
      { readOnly: true },
    );
    return row ? this.toDomain(row) : null;
  }

  async findBySourceKey(sourceKey: string): Promise<StoredFile | null> {
    return this.findOne({ sourceKey });
  }

  async findByKey(key: string): Promise<StoredFile | null> {
    return this.findOne({ key });
  }

  async findById(id: string): Promise<StoredFile | null> {
    return this.findOne({ id });
  }

  async create(props: StoredFileProps): Promise<StoredFileCreateOutcome> {
    try {
      await this.run((client) => client.storedFile.create({ data: props }), { readOnly: false });
      return 'created';
    } catch (err) {
      if (isUniqueConstraintViolation(err)) return 'duplicate';
      throw err;
    }
  }

  async createBatch(props: readonly StoredFileProps[]): Promise<void> {
    if (props.length === 0) throw new Error('Cannot create an empty upload batch');
    await this.run((client) => client.storedFile.createMany({ data: [...props] }), {
      readOnly: false,
    });
  }

  async publishBatch(ids: readonly string[], status: 'READY' | 'VERIFYING'): Promise<void> {
    if (ids.length === 0 || new Set(ids).size !== ids.length) {
      throw new Error('Upload publication requires a nonempty set of distinct IDs');
    }
    await this.run(
      async (client) => {
        const updated = await client.storedFile.updateMany({
          where: { id: { in: [...ids] }, status: STORED_FILE_STATUS.FINALIZING, deletedAt: null },
          data: { status },
        });
        if (updated.count !== ids.length) {
          throw new Error('Upload batch changed before publication');
        }
      },
      { readOnly: false },
    );
  }

  private async setStatus(
    selector: StoredFileSelector,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean> {
    const where = matchesSoftDeleted(from, to)
      ? { ...selector, status: from }
      : { ...selector, status: from, deletedAt: null };
    const result = await this.run(
      (client) =>
        client.storedFile.updateMany({
          where,
          data: { status: to, ...fields },
        }),
      { readOnly: false },
    );
    return result.count > 0;
  }

  transition(
    id: string,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean> {
    return this.setStatus({ id }, from, to, fields);
  }

  transitionByKey(
    key: string,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean> {
    return this.setStatus({ key }, from, to, fields);
  }

  async deleteIfStatus(id: string, status: StoredFileStatus): Promise<void> {
    await this.run((client) => client.storedFile.deleteMany({ where: { id, status } }), {
      readOnly: false,
    });
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.run(
      (client) =>
        client.storedFile.updateMany({
          where: { id, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
      { readOnly: false },
    );
    return result.count > 0;
  }

  private toDomain(row: StoredFileRow): StoredFile {
    return StoredFile.create({
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      sourceKey: row.sourceKey,
      key: row.key,
      bucket: row.bucket,
      contentType: row.contentType,
      size: row.size,
      etag: row.etag,
      status: row.status as StoredFileStatus,
    });
  }
}
