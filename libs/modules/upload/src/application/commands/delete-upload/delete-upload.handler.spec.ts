import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PERMISSIONS, STORED_FILE_STATUS, SYSTEM_ROLES } from '@nestjs-fastify-nx/shared';
import { isDomainException, type AuthorizationPort } from '@nestjs-fastify-nx/core';
import { InMemoryAuthorizationAdapter } from '@nestjs-fastify-nx/infra-authorization';
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

const notFound = (err: unknown) => isDomainException(err) && err.kind === 'not_found';

describe('DeleteUploadHandler', () => {
  let files: Record<keyof StoredFileRepositoryPort, Mock>;
  let authorization: InMemoryAuthorizationAdapter;
  let handler: DeleteUploadHandler;

  beforeEach(() => {
    files = repositoryMock();
    authorization = new InMemoryAuthorizationAdapter();
    authorization.setMemberRoles(ORG_ID, USER_ID, [SYSTEM_ROLES.MEMBER]);
    handler = new DeleteUploadHandler(
      files as unknown as StoredFileRepositoryPort,
      authorization as unknown as AuthorizationPort,
    );
  });

  const command = (userId = USER_ID, organizationId = ORG_ID) =>
    new DeleteUploadCommand(organizationId, userId, FILE_ID);

  it('soft-deletes a file the caller may delete', async () => {
    await handler.execute(command());

    expect(files.softDelete).toHaveBeenCalledWith(FILE_ID);
  });

  // The reason this check lives in the handler rather than on the route: a role without org-wide
  // file:delete still owns what it uploaded, and only this layer knows who the owner is.
  it('lets an owner delete their own file after losing the org-wide permission', async () => {
    authorization.setMemberRoles(ORG_ID, USER_ID, [SYSTEM_ROLES.VIEWER]);

    await handler.execute(command());

    expect(files.softDelete).toHaveBeenCalledWith(FILE_ID);
  });

  it('lets an admin delete a file another member owns', async () => {
    authorization.setMemberRoles(ORG_ID, OTHER_USER_ID, [SYSTEM_ROLES.ADMIN]);

    await handler.execute(command(OTHER_USER_ID));

    expect(files.softDelete).toHaveBeenCalledWith(FILE_ID);
  });

  it('answers not_found when the file does not exist', async () => {
    files.findById.mockResolvedValue(null);

    await expect(handler.execute(command())).rejects.toSatisfy(notFound);
    expect(files.softDelete).not.toHaveBeenCalled();
  });

  it('answers not_found — never forbidden — for a member without the permission', async () => {
    authorization.setMemberRoles(ORG_ID, OTHER_USER_ID, [SYSTEM_ROLES.VIEWER]);

    await expect(handler.execute(command(OTHER_USER_ID))).rejects.toSatisfy(notFound);
    expect(files.softDelete).not.toHaveBeenCalled();
  });

  it('refuses a file belonging to another organization', async () => {
    files.findById.mockResolvedValue(storedFile({ organizationId: OTHER_ORG_ID }));

    await expect(handler.execute(command())).rejects.toSatisfy(notFound);
    expect(files.softDelete).not.toHaveBeenCalled();
  });

  it('is idempotent when the row was already soft-deleted concurrently', async () => {
    files.softDelete.mockResolvedValue(false);

    await expect(handler.execute(command())).resolves.toBeUndefined();
  });

  it('checks the permission against the loaded resource, not the bare permission', async () => {
    const spy = vi.spyOn(authorization, 'check');

    await handler.execute(command());

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user', userId: USER_ID, organizationId: ORG_ID }),
      PERMISSIONS.FILE_DELETE,
      expect.objectContaining({ id: FILE_ID, organizationId: ORG_ID, ownerId: USER_ID }),
    );
  });
});
