import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readUploadLimits,
  UPLOAD_DEFAULT_MAX_FILE_BYTES,
  UPLOAD_MAGIC_BYTE_COUNT,
} from './upload-limits';

afterEach(() => vi.unstubAllEnvs());

describe('readUploadLimits', () => {
  it('falls back to the documented defaults when nothing is configured', () => {
    vi.stubEnv('UPLOAD_MAX_FILE_BYTES', '');
    vi.stubEnv('UPLOAD_PRESIGN_EXPIRES_SECONDS', '');
    vi.stubEnv('MALWARE_SCANNER_ENABLED', '');
    vi.stubEnv('STORAGE_BUCKET', undefined);

    expect(readUploadLimits()).toEqual({
      maxFileBytes: UPLOAD_DEFAULT_MAX_FILE_BYTES,
      presignExpiresSeconds: 300,
      magicByteCount: UPLOAD_MAGIC_BYTE_COUNT,
      malwareScanEnabled: false,
      bucket: 'uploads',
    });
  });

  it('reads every value from the environment when configured', () => {
    vi.stubEnv('UPLOAD_MAX_FILE_BYTES', '2048');
    vi.stubEnv('UPLOAD_PRESIGN_EXPIRES_SECONDS', '60');
    vi.stubEnv('MALWARE_SCANNER_ENABLED', 'true');
    vi.stubEnv('STORAGE_BUCKET', 'custom-bucket');

    expect(readUploadLimits()).toEqual({
      maxFileBytes: 2048,
      presignExpiresSeconds: 60,
      magicByteCount: UPLOAD_MAGIC_BYTE_COUNT,
      malwareScanEnabled: true,
      bucket: 'custom-bucket',
    });
  });
});
