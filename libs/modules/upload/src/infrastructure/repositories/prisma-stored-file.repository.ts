import { Injectable } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { StoredFileStatus } from '@nestjs-fastify-nx/shared';
import { StoredFile, type StoredFileProps } from '../../domain/entities/stored-file.entity';
import type {
  StoredFileRepositoryPort,
  StoredFileTransitionFields,
} from '../../domain/ports/stored-file-repository.port';

interface StoredFileRow {
  id: string;
  userId: string;
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

  // Reads go to the replica when one is configured, writes to the primary — and both defer to an
  // open interactive transaction so a repository call inside one commits atomically with it.
  private get reader() {
    return this.prisma.currentTransaction ?? this.prisma.dbRead;
  }

  private get writer() {
    return this.prisma.currentTransaction ?? this.prisma.db;
  }

  async findBySourceKey(sourceKey: string): Promise<StoredFile | null> {
    const row = await this.reader.storedFile.findUnique({ where: { sourceKey } });
    return row ? this.toDomain(row) : null;
  }

  async findByKey(key: string): Promise<StoredFile | null> {
    const row = await this.reader.storedFile.findUnique({ where: { key } });
    return row ? this.toDomain(row) : null;
  }

  async create(props: StoredFileProps): Promise<void> {
    await this.writer.storedFile.create({ data: props });
  }

  async transition(
    id: string,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean> {
    const result = await this.writer.storedFile.updateMany({
      where: { id, status: from },
      data: { status: to, ...fields },
    });
    return result.count > 0;
  }

  async transitionByKey(
    key: string,
    from: StoredFileStatus,
    to: StoredFileStatus,
    fields?: StoredFileTransitionFields,
  ): Promise<boolean> {
    const result = await this.writer.storedFile.updateMany({
      where: { key, status: from },
      data: { status: to, ...fields },
    });
    return result.count > 0;
  }

  async deleteIfStatus(id: string, status: StoredFileStatus): Promise<void> {
    await this.writer.storedFile.deleteMany({ where: { id, status } });
  }

  private toDomain(row: StoredFileRow): StoredFile {
    return StoredFile.create({
      id: row.id,
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
