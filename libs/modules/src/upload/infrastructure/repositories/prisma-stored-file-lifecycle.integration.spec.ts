import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import type { StoredFileProps } from '../../domain/entities/stored-file.entity';
import { PrismaStoredFileRepository } from './prisma-stored-file.repository';

const ORG_ID = '019dd1a5-9235-70db-8d57-540800000001';
const USER_ID = '019dd1a5-9235-70db-8d57-540800000002';

function storedFile(id: string, overrides: Partial<StoredFileProps> = {}): StoredFileProps {
  return {
    id,
    organizationId: ORG_ID,
    userId: USER_ID,
    sourceKey: `uploads/${USER_ID}/${id}.png`,
    key: `files/${USER_ID}/${id}.png`,
    bucket: 'uploads',
    contentType: 'image/png',
    size: 1,
    etag: `"etag-${id}"`,
    status: STORED_FILE_STATUS.FINALIZING,
    ...overrides,
  };
}

describe('PrismaStoredFileRepository lifecycle (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let repository: PrismaStoredFileRepository;
  let cleaner: DatabaseCleaner;

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();
    repository = new PrismaStoredFileRepository(prisma);
    cleaner = new DatabaseCleaner(prisma.db);
  }, 90_000);

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    await prisma.db.user.create({
      data: { id: USER_ID, name: 'Uploader', email: 'uploader@stored-files.local' },
    });
    await prisma.db.organization.create({
      data: { id: ORG_ID, name: 'Uploads', slug: 'uploads' },
    });
  });

  it('applies FINALIZING to READY exactly once', async () => {
    const id = '019dd1a5-9235-70db-8d57-540800000011';
    await repository.create(storedFile(id));

    expect(
      await repository.transition(id, STORED_FILE_STATUS.FINALIZING, STORED_FILE_STATUS.READY),
    ).toBe(true);
    expect(
      await repository.transition(id, STORED_FILE_STATUS.FINALIZING, STORED_FILE_STATUS.READY),
    ).toBe(false);

    const row = await prisma.db.storedFile.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(STORED_FILE_STATUS.READY);
  });

  it('records verification fields on the VERIFYING to READY transition by key', async () => {
    const id = '019dd1a5-9235-70db-8d57-540800000012';
    const props = storedFile(id, { status: STORED_FILE_STATUS.VERIFYING });
    const verifiedAt = new Date('2026-09-01T00:00:00.000Z');
    await repository.create(props);

    expect(
      await repository.transitionByKey(
        props.key,
        STORED_FILE_STATUS.VERIFYING,
        STORED_FILE_STATUS.READY,
        { verifiedAt, failureReason: null },
      ),
    ).toBe(true);

    const row = await prisma.db.storedFile.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(STORED_FILE_STATUS.READY);
    expect(row.verifiedAt).toEqual(verifiedAt);
    expect(row.failureReason).toBeNull();
  });

  it('quarantines an in-flight upload even after it was soft-deleted', async () => {
    const inFlightId = '019dd1a5-9235-70db-8d57-540800000013';
    const readyId = '019dd1a5-9235-70db-8d57-540800000014';
    await repository.create(storedFile(inFlightId));
    await repository.create(storedFile(readyId, { status: STORED_FILE_STATUS.READY }));
    await prisma.db.storedFile.updateMany({
      where: { id: { in: [inFlightId, readyId] } },
      data: { deletedAt: new Date() },
    });

    expect(
      await repository.transition(
        inFlightId,
        STORED_FILE_STATUS.FINALIZING,
        STORED_FILE_STATUS.REJECTED,
        { failureReason: 'Malware detected' },
      ),
    ).toBe(true);
    expect(
      await repository.transition(
        inFlightId,
        STORED_FILE_STATUS.FINALIZING,
        STORED_FILE_STATUS.REJECTED,
        { failureReason: 'Malware detected' },
      ),
    ).toBe(false);
    expect(
      await repository.transition(readyId, STORED_FILE_STATUS.READY, STORED_FILE_STATUS.REJECTED),
    ).toBe(false);

    const rows = await prisma.db.storedFile.findMany({
      where: { id: { in: [inFlightId, readyId] } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(inFlightId)).toMatchObject({
      status: STORED_FILE_STATUS.REJECTED,
      failureReason: 'Malware detected',
    });
    expect(byId.get(readyId)).toMatchObject({
      status: STORED_FILE_STATUS.READY,
      failureReason: null,
    });
  });

  it('reads its own uncommitted write through the active transaction', async () => {
    const id = '019dd1a5-9235-70db-8d57-540800000016';

    await prisma.transaction(async () => {
      await repository.create(storedFile(id));
      expect(await repository.findById(id)).not.toBeNull();
    });
  });

  it('reports a lost race instead of throwing', async () => {
    const id = '019dd1a5-9235-70db-8d57-540800000015';
    await repository.create(storedFile(id));

    expect(
      await repository.transition(id, STORED_FILE_STATUS.VERIFYING, STORED_FILE_STATUS.READY),
    ).toBe(false);

    const row = await prisma.db.storedFile.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(STORED_FILE_STATUS.FINALIZING);
  });

  it('publishes a FINALIZING batch in one flip and only once', async () => {
    const ids = ['019dd1a5-9235-70db-8d57-540800000021', '019dd1a5-9235-70db-8d57-540800000022'];
    for (const id of ids) await repository.create(storedFile(id));

    await repository.publishBatch(ids, STORED_FILE_STATUS.READY);

    const rows = await prisma.db.storedFile.findMany({ where: { id: { in: ids } } });
    expect(rows.map((row) => row.status)).toEqual([
      STORED_FILE_STATUS.READY,
      STORED_FILE_STATUS.READY,
    ]);
    await expect(repository.publishBatch(ids, STORED_FILE_STATUS.READY)).rejects.toThrow(
      'Upload batch changed before publication',
    );
  });

  it('rejects publication when the batch changed under it', async () => {
    const inFlightId = '019dd1a5-9235-70db-8d57-540800000023';
    const readyId = '019dd1a5-9235-70db-8d57-540800000024';
    await repository.create(storedFile(inFlightId));
    await repository.create(storedFile(readyId, { status: STORED_FILE_STATUS.READY }));

    await expect(
      repository.publishBatch([inFlightId, readyId], STORED_FILE_STATUS.READY),
    ).rejects.toThrow('Upload batch changed before publication');

    const row = await prisma.db.storedFile.findUniqueOrThrow({ where: { id: readyId } });
    expect(row.status).toBe(STORED_FILE_STATUS.READY);
  });

  it('refuses an empty or duplicate id set without writing', async () => {
    const id = '019dd1a5-9235-70db-8d57-540800000025';

    await expect(repository.publishBatch([], STORED_FILE_STATUS.READY)).rejects.toThrow(
      'nonempty set of distinct IDs',
    );
    await expect(repository.publishBatch([id, id], STORED_FILE_STATUS.READY)).rejects.toThrow(
      'nonempty set of distinct IDs',
    );
    expect(await prisma.db.storedFile.count()).toBe(0);
  });

  it('reports a duplicate when the source key or object key is taken', async () => {
    const existing = storedFile('019dd1a5-9235-70db-8d57-540800000031');
    expect(await repository.create(existing)).toBe('created');
    expect(
      await repository.create(
        storedFile('019dd1a5-9235-70db-8d57-540800000032', {
          sourceKey: existing.sourceKey,
        }),
      ),
    ).toBe('duplicate');
    expect(
      await repository.create(
        storedFile('019dd1a5-9235-70db-8d57-540800000033', { key: existing.key }),
      ),
    ).toBe('duplicate');
  });

  it('re-throws a create failure that is not a unique violation', async () => {
    await expect(
      repository.create(storedFile('019dd1a5-9235-70db-8d57-540800000034', { size: 0 })),
    ).rejects.toThrow();
    expect(await prisma.db.storedFile.count()).toBe(0);
  });

  it('soft-deletes a live row once and hides it from reads', async () => {
    const id = '019dd1a5-9235-70db-8d57-540800000036';
    await repository.create(storedFile(id));

    expect(await repository.softDelete(id)).toBe(true);
    const first = await prisma.db.storedFile.findUniqueOrThrow({ where: { id } });
    expect(first.deletedAt).not.toBeNull();

    expect(await repository.softDelete(id)).toBe(false);
    const second = await prisma.db.storedFile.findUniqueOrThrow({ where: { id } });
    expect(second.deletedAt).toEqual(first.deletedAt);
    expect(await repository.findById(id)).toBeNull();
  });

  it('deletes only while the row still holds the expected status', async () => {
    const id = '019dd1a5-9235-70db-8d57-540800000035';
    await repository.create(storedFile(id));

    await repository.deleteIfStatus(id, STORED_FILE_STATUS.READY);
    expect(await prisma.db.storedFile.findUnique({ where: { id } })).not.toBeNull();

    await repository.deleteIfStatus(id, STORED_FILE_STATUS.FINALIZING);
    expect(await prisma.db.storedFile.findUnique({ where: { id } })).toBeNull();
  });
}, 90_000);
