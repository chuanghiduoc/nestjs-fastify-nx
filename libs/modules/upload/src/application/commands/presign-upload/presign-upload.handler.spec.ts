import { describe, expect, it, vi } from 'vitest';
import type { StoragePort } from '@nestjs-fastify-nx/infra-storage';
import type { UploadLimits } from '../../upload-limits';
import { PresignUploadCommand } from './presign-upload.command';
import { PresignUploadHandler } from './presign-upload.handler';

const USER_ID = '019dd1a5-9235-70db-8d57-54ef901d8185';
const LIMITS: UploadLimits = {
  maxFileBytes: 10 * 1024 * 1024,
  presignExpiresSeconds: 300,
  magicByteCount: 16,
};

function build() {
  const storage = { presignUpload: vi.fn().mockResolvedValue({ key: 'k' }) };
  const handler = new PresignUploadHandler(storage as unknown as StoragePort, LIMITS);
  return { handler, storage };
}

describe('PresignUploadHandler', () => {
  it('scopes the key under the caller and mirrors the configured cap and expiry', async () => {
    const { handler, storage } = build();

    await handler.execute(new PresignUploadCommand(USER_ID, 'image/png'));

    expect(storage.presignUpload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^uploads/${USER_ID}/[0-9a-f-]+\\.png$`)),
      { contentType: 'image/png', maxBytes: LIMITS.maxFileBytes, expiresInSeconds: 300 },
    );
  });

  it('rejects a mime type outside the allow-list before reaching storage', async () => {
    const { handler, storage } = build();

    await expect(
      handler.execute(new PresignUploadCommand(USER_ID, 'application/x-msdownload')),
    ).rejects.toMatchObject({ kind: 'validation', code: 'upload_mime_not_allowed' });
    expect(storage.presignUpload).not.toHaveBeenCalled();
  });
});
