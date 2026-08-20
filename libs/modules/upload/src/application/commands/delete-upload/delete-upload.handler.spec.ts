import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { STORED_FILE_STATUS } from '@nestjs-fastify-nx/shared';
import { isDomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { StoredFile } from '../../../domain/entities/stored-file.entity';
import type { StoredFileRepositoryPort } from '../../../domain/ports/stored-file-repository.port';
import { DeleteUploadCommand } from './delete-upload.command';
import { DeleteUploadHandler } from './delete-upload.handler';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef901d8100';
const OTHER_ORG_ID = '019dd1a5-9235-70db-8d57-54ef901d8200';
const USER_ID = '019dd1a5-9235-70db-8d57-54ef901d8300';
const OTHER_USER_ID = '019dd1a5-9235-70db-8d57-54ef901d8400';
const FILE_ID = '019dd1a5-9235-70db-8d57-54ef901d8500';

function storedFile(overrides: { organizationId?: string; userId?: string } = {}): StoredFile {
  return StoredFile.create({
    id: FILE_ID,
    organizationId: overrides.organizationId ?? ORG_ID,
    userId: overrides.userId ?? USER_ID,
    sourceKey: `uploads/${USER_ID}/x.png`,
    key: `files/${USER_ID}/${FILE_ID}.png`,
    bucket: 'uploads',
    contentType: 'image/png',
    size: 8,
    etag: '"etag"',
    status: STORED_FILE_STATUS.READY,
  });
}

function repositoryMock(): Record<keyof StoredFileRepositoryPort, Mock> {
  return {
    findBySourceKey: vi.fn().mockResolvedValue(null),
    findByKey: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(storedFile()),
    create: vi.fn().mockResolvedValue(undefined),
    transition: vi.fn().mockResolvedValue(true),
    transitionByKey: vi.fn().mockResolvedValue(true),
    deleteIfStatus: vi.fn().mockResolvedValue(undefined),
    softDelete: vi.fn().mockResolvedValue(true),
  };
}

describe('DeleteUploadHandler', () => {
  let files: Record<keyof StoredFileRepositoryPort, Mock>;
  let handler: DeleteUploadHandler;

  beforeEach(() => {
    files = repositoryMock();
    handler = new DeleteUploadHandler(files as unknown as StoredFileRepositoryPort);
  });

  const command = (userId = USER_ID, organizationId = ORG_ID) =>
    new DeleteUploadCommand(organizationId, userId, FILE_ID);

  it('soft-deletes a file the caller owns', async () => {
    await handler.execute(command());

    expect(files.softDelete).toHaveBeenCalledWith(FILE_ID);
  });

  it('answers not_found when the file does not exist', async () => {
    files.findById.mockResolvedValue(null);

    await expect(handler.execute(command())).rejects.toSatisfy(
      (err: unknown) =>
        isDomainException(err) && err.kind === 'not_found' && err.code === ERROR_CODES.NOT_FOUND,
    );
    expect(files.softDelete).not.toHaveBeenCalled();
  });

  it('answers not_found — never forbidden — for a file owned by another member', async () => {
    files.findById.mockResolvedValue(storedFile({ userId: OTHER_USER_ID }));

    await expect(handler.execute(command())).rejects.toSatisfy(
      (err: unknown) => isDomainException(err) && err.kind === 'not_found',
    );
    expect(files.softDelete).not.toHaveBeenCalled();
  });

  it('refuses a file belonging to another organization', async () => {
    files.findById.mockResolvedValue(storedFile({ organizationId: OTHER_ORG_ID }));

    await expect(handler.execute(command())).rejects.toSatisfy(
      (err: unknown) => isDomainException(err) && err.kind === 'not_found',
    );
    expect(files.softDelete).not.toHaveBeenCalled();
  });

  it('is idempotent when the row was already soft-deleted concurrently', async () => {
    files.softDelete.mockResolvedValue(false);

    await expect(handler.execute(command())).resolves.toBeUndefined();
  });
});
