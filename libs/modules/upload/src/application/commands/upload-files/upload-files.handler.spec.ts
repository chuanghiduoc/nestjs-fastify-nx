import type * as NodeFs from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { StoragePort } from '@nestjs-fastify-nx/infra-storage';
import type { StoredFileRepositoryPort } from '../../../domain/ports/stored-file-repository.port';
import type { StoredFile, StoredFileProps } from '../../../domain/entities/stored-file.entity';
import { UploadFilesCommand } from './upload-files.command';
import { UploadFilesHandler } from './upload-files.handler';
import type { UploadPublicationService } from '../../upload-publication.service';

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof NodeFs>(),
  createReadStream: vi.fn(() => Readable.from([Buffer.from('payload')])),
}));

function build(options: { scan?: boolean } = {}) {
  const storage = {
    uploadStream: vi.fn(async (_key: string, body: Readable) => { body.destroy(); }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const files = {
    createBatch: vi.fn().mockResolvedValue(undefined),
    publishBatch: vi.fn().mockResolvedValue(undefined),
    deleteIfStatus: vi.fn().mockResolvedValue(undefined),
  };
  const publication = { result: vi.fn(async (file: StoredFile) => ({ id: file.id, status: file.status })) };
  const handler = new UploadFilesHandler(
    storage as unknown as StoragePort,
    files as unknown as StoredFileRepositoryPort,
    { bucket: 'uploads', malwareScanEnabled: options.scan ?? false, maxFileBytes: 100, magicByteCount: 16, presignExpiresSeconds: 300 },
    publication as unknown as UploadPublicationService,
  );
  const controller = new AbortController();
  const command = new UploadFilesCommand({
    organizationId: 'organization', userId: 'user', signal: controller.signal,
    files: [
      { filepath: 'first', size: 7, contentType: 'image/png', digest: 'digest-first' },
      { filepath: 'second', size: 7, contentType: 'image/png', digest: 'digest-second' },
    ],
  });
  return { storage, files, publication, handler, controller, command };
}

describe('UploadFilesHandler', () => {
  it.each([{ scan: false, status: 'READY' }, { scan: true, status: 'VERIFYING' }])(
    'publishes the entire batch as $status after every object has uploaded',
    async ({ scan, status }) => {
      const { handler, command, files, storage, publication } = build({ scan });
      const results = await handler.execute(command);
      const created = files.createBatch.mock.calls[0]?.[0] as StoredFileProps[];
      expect(created).toHaveLength(2);
      expect(new Set(created.map((file) => file.key)).size).toBe(2);
      expect(created.every((file) => file.status === 'FINALIZING')).toBe(true);
      expect(created[0]).toMatchObject({ organizationId: 'organization', userId: 'user', etag: 'digest-first' });
      expect(created[0]?.key).toMatch(/^files\/user\/.+\.png$/);
      expect(storage.uploadStream).toHaveBeenCalledTimes(2);
      expect(files.publishBatch).toHaveBeenCalledWith(created.map((file) => file.id), status);
      expect(files.createBatch.mock.invocationCallOrder[0]).toBeLessThan(storage.uploadStream.mock.invocationCallOrder[0] ?? 0);
      expect(storage.uploadStream.mock.invocationCallOrder[1]).toBeLessThan(files.publishBatch.mock.invocationCallOrder[0] ?? 0);
      expect(files.publishBatch.mock.invocationCallOrder[0]).toBeLessThan(publication.result.mock.invocationCallOrder[0] ?? 0);
      expect(results.every((file) => file.status === status)).toBe(true);
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );

  it('does not upload when reserving metadata fails', async () => {
    const { handler, command, files, storage } = build();
    files.createBatch.mockRejectedValue(new Error('database unavailable'));
    await expect(handler.execute(command)).rejects.toThrow('database unavailable');
    expect(storage.uploadStream).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('cleans every reserved object and row on a partial S3 failure without publishing', async () => {
    const { handler, command, files, storage } = build();
    storage.uploadStream.mockImplementationOnce(async (_key, body) => { body.destroy(); })
      .mockImplementationOnce(async (_key, body) => { body.destroy(); throw new Error('S3 failed'); });
    await expect(handler.execute(command)).rejects.toThrow('S3 failed');
    expect(files.publishBatch).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(files.deleteIfStatus).toHaveBeenCalledTimes(2);
  });

  it('retains a FINALIZING row when deleting its object fails', async () => {
    const { handler, command, files, storage } = build();
    storage.uploadStream.mockImplementation(async (_key, body) => { body.destroy(); throw new Error('S3 failed'); });
    storage.delete.mockRejectedValueOnce(new Error('cleanup unavailable'));
    await expect(handler.execute(command)).rejects.toThrow('S3 failed');
    expect(files.deleteIfStatus).toHaveBeenCalledTimes(1);
  });

  it('cancels between files and removes unfinished batch objects', async () => {
    const { handler, command, controller, files, storage } = build();
    storage.uploadStream.mockImplementationOnce(async (_key, body) => { body.destroy(); controller.abort(); });
    await expect(handler.execute(command)).rejects.toThrow();
    expect(storage.uploadStream).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(files.publishBatch).not.toHaveBeenCalled();
  });

  it('does not delete objects when publication has an unknown commit outcome', async () => {
    const { handler, command, files, storage } = build();
    files.publishBatch.mockRejectedValue(new Error('transaction connection lost'));
    await expect(handler.execute(command)).rejects.toThrow('transaction connection lost');
    expect(storage.delete).not.toHaveBeenCalled();
    expect(files.deleteIfStatus).not.toHaveBeenCalled();
  });

  it('does not delete published files when generating the result fails', async () => {
    const { handler, command, publication, storage, files } = build();
    publication.result.mockRejectedValue(new Error('signing failed'));
    await expect(handler.execute(command)).rejects.toThrow('signing failed');
    expect(files.publishBatch).toHaveBeenCalledOnce();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(files.deleteIfStatus).not.toHaveBeenCalled();
  });
});
