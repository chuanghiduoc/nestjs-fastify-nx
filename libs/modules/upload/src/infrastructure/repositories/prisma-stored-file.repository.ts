import { Injectable } from '@nestjs/common';
import { PrismaService, type TransactionClient } from '@nestjs-fastify-nx/infra-database';
import { STORED_FILE_STATUS, type StoredFileStatus } from '@nestjs-fastify-nx/shared';
import { StoredFile, type StoredFileProps } from '../../domain/entities/stored-file.entity';
import type {
  StoredFileRepositoryPort,
  StoredFileTransitionFields,
} from '../../domain/ports/stored-file-repository.port';

interface StoredFileRow {
  id: string;
  organizationId: string;
  userId: string;
  deletedAt: Date | null;
  sourceKey: string;
  key: string;
  bucket: string;
  contentType: string;
  size: number;
  etag: string;
  status: string;
}

@Injectable()
export class PrismaStoredFileRepository implements StoredFileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  private run<R>(
    fn: (client: TransactionClient) => Promise<R>,
    options: { readOnly: boolean },
  ): Promise<R> {
    const active = options.readOnly
      ? (this.prisma.currentTransaction ?? this.prisma.currentReadTransaction)
      : this.prisma.currentTransaction;
    if (active) return fn(active);
    if (!this.prisma.hasTenantContext) {
      return fn(options.readOnly ? this.prisma.dbRead : this.prisma.db);
    }
    return this.prisma.withTenantContext(fn, { readOnly: options.readOnly });
  }

  async findBySourceKey(sourceKey: string): Promise<StoredFile | null> {
    const row = await this.run(
      (client) => client.storedFile.findFirst({ where: { sourceKey, deletedAt: null } }),
      { readOnly: true },
    );
    return row ? this.toDomain(row) : null;
  }

  async findByKey(key: string): Promise<StoredFile | null> {
    const row = await this.run(
      (client) => client.storedFile.findFirst({ where: { key, deletedAt: null } }),
      { readOnly: true },
    );
    return row ? this.toDomain(row) : null;
  }

  async findById(id: string): Promise<StoredFile | null> {
    const row = await this.run(
      (client) => client.storedFile.findFirst({ where: { id, deletedAt: null } }),
      { readOnly: true },
    );
    return row ? this.toDomain(row) : null;
  }

  async create(props: StoredFileProps): Promise<void> {
    await this.run((client) => client.storedFile.create({ data: props }), { readOnly: false });
  }

  async transition(
    id: string,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean> {
    const allowDeleted =
      to === STORED_FILE_STATUS.REJECTED &&
      (from === STORED_FILE_STATUS.FINALIZING || from === STORED_FILE_STATUS.VERIFYING);
    const where = allowDeleted ? { id, status: from } : { id, status: from, deletedAt: null };
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

  async transitionByKey(
    key: string,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean> {
    const allowDeleted =
      to === STORED_FILE_STATUS.REJECTED &&
      (from === STORED_FILE_STATUS.FINALIZING || from === STORED_FILE_STATUS.VERIFYING);
    const where = allowDeleted ? { key, status: from } : { key, status: from, deletedAt: null };
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
      deletedAt: row.deletedAt,
    });
  }
}
