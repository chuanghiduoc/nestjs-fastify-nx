import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { DomainException } from '@nestjs-fastify-nx/core';
import {
  DeleteObjectCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { S3StorageAdapter } from './s3-storage.adapter';

type PostParams = { Fields?: Record<string, string>; Conditions?: unknown[] };

// The adapter keeps its clients private, and the SDK normalises each config value into either a
// literal or a provider function — so read it back the same way the SDK would.
async function resolvedClientConfig(
  adapter: S3StorageAdapter,
): Promise<{ forcePathStyle: boolean; requestChecksumCalculation: string }> {
  const config = (adapter as unknown as { client: { config: Record<string, unknown> } }).client
    .config;
  const read = async (key: string): Promise<unknown> => {
    const value = config[key];
    return typeof value === 'function' ? await (value as () => Promise<unknown>)() : value;
  };
  return {
    forcePathStyle: (await read('forcePathStyle')) as boolean,
    requestChecksumCalculation: (await read('requestChecksumCalculation')) as string,
  };
}

// `getSignedUrl` from @aws-sdk/s3-request-presigner is a static helper —
// stub it before importing the adapter so getSignedUrl() returns a stable
// value in tests without making a real signing roundtrip.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/uploads/k?X-Amz-...'),
}));

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: vi.fn().mockResolvedValue({
    url: 'https://s3.example/uploads',
    fields: { key: 'uploads/x', 'Content-Type': 'image/png' },
  }),
}));

function makeConfigService(overrides: Record<string, string> = {}): ConfigService {
  const env: Record<string, string> = {
    STORAGE_ENDPOINT: 'http://minio:9000',
    STORAGE_BUCKET: 'uploads',
    STORAGE_REGION: 'us-east-1',
    STORAGE_ACCESS_KEY: 'k',
    STORAGE_SECRET_KEY: 's',
    ...overrides,
  };
  return { get: vi.fn((key: string) => env[key]) } as unknown as ConfigService;
}

/** Replace `client.send` with a controlled mock; AWS SDK is otherwise untouched. */
function mockSend(adapter: S3StorageAdapter): ReturnType<typeof vi.fn> {
  const send = vi.fn();
  // `client` is private; we patch via cast for test purposes only.
  (adapter as unknown as { client: { send: typeof send } }).client.send = send;
  return send;
}

describe('S3StorageAdapter', () => {
  let adapter: S3StorageAdapter;
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    adapter = new S3StorageAdapter(makeConfigService());
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
  });

  describe('onModuleInit', () => {
    it('fails startup in production when the configured bucket is inaccessible', async () => {
      process.env['NODE_ENV'] = 'production';
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(
        Object.assign(new Error('Forbidden'), { $metadata: { httpStatusCode: 403 } }),
      );

      await expect(adapter.onModuleInit()).rejects.toThrow('Bucket head check failed');
    });

    it('does not create a missing bucket in production', async () => {
      process.env['NODE_ENV'] = 'production';
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(
        Object.assign(new Error('NotFound'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        }),
      );

      await expect(adapter.onModuleInit()).rejects.toThrow('provision it outside');
      expect(send).toHaveBeenCalledOnce();
    });

    it('creates a missing bucket only in development', async () => {
      process.env['NODE_ENV'] = 'development';
      const send = mockSend(adapter);
      send
        .mockRejectedValueOnce(
          Object.assign(new Error('NotFound'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          }),
        )
        .mockResolvedValueOnce({});

      await expect(adapter.onModuleInit()).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
    });

    it('continues in development when storage is temporarily unavailable', async () => {
      process.env['NODE_ENV'] = 'development';
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(adapter.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('upload', () => {
    it('rejects an empty body with DomainException (no S3 call)', async () => {
      const send = mockSend(adapter);
      await expect(adapter.upload('uploads/x', Buffer.alloc(0))).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it('sends a PutObjectCommand and returns path-style URL on success', async () => {
      const send = mockSend(adapter);
      send.mockResolvedValueOnce({});
      const result = await adapter.upload('uploads/x', Buffer.from('payload'), {
        contentType: 'image/png',
      });
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
      expect(result).toEqual({
        key: 'uploads/x',
        bucket: 'uploads',
        url: 'http://minio:9000/uploads/uploads/x',
        size: 7,
      });
    });

    it('wraps S3 errors as DomainException with unavailable kind', async () => {
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(new Error('NoSuchBucket'));
      await expect(adapter.upload('uploads/x', Buffer.from('p'))).rejects.toBeInstanceOf(
        DomainException,
      );
    });
  });

  describe('head', () => {
    it('returns null on 404 (object not yet uploaded)', async () => {
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(
        Object.assign(new Error('NotFound'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        }),
      );
      const result = await adapter.head('uploads/missing');
      expect(result).toBeNull();
    });

    it('returns metadata on 200', async () => {
      const send = mockSend(adapter);
      send.mockResolvedValueOnce({
        ContentType: 'image/png',
        ContentLength: 1234,
        ETag: '"etag-1"',
      });
      const result = await adapter.head('uploads/x');
      expect(result).toEqual({
        contentType: 'image/png',
        size: 1234,
        bucket: 'uploads',
        etag: '"etag-1"',
      });
      expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    });

    it('throws DomainException for non-404 errors', async () => {
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(
        Object.assign(new Error('Forbidden'), { $metadata: { httpStatusCode: 403 } }),
      );
      await expect(adapter.head('uploads/x')).rejects.toBeInstanceOf(DomainException);
    });

    it('defaults contentType to application/octet-stream when missing', async () => {
      const send = mockSend(adapter);
      send.mockResolvedValueOnce({ ContentLength: 0, ETag: '"etag-1"' });
      const result = await adapter.head('uploads/x');
      expect(result?.contentType).toBe('application/octet-stream');
    });
  });

  describe('readRange', () => {
    it('returns a Buffer of the first N bytes on success', async () => {
      const send = mockSend(adapter);
      send.mockResolvedValueOnce({
        Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])) },
      });
      const result = await adapter.readRange('uploads/x', 4);
      expect(result.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
      const cmd = send.mock.calls[0][0] as GetObjectCommand;
      expect(cmd).toBeInstanceOf(GetObjectCommand);
      expect(cmd.input.Range).toBe('bytes=0-3');
    });

    it('throws DomainException when Body lacks transformToByteArray', async () => {
      const send = mockSend(adapter);
      send.mockResolvedValueOnce({ Body: undefined });
      await expect(adapter.readRange('uploads/x', 16)).rejects.toBeInstanceOf(DomainException);
    });

    it('clamps the Range header to 0-0 when byteCount is 0', async () => {
      const send = mockSend(adapter);
      send.mockResolvedValueOnce({
        Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([])) },
      });
      await adapter.readRange('uploads/x', 0);
      const cmd = send.mock.calls[0][0] as GetObjectCommand;
      expect(cmd.input.Range).toBe('bytes=0-0');
    });

    it('wraps SDK errors as DomainException', async () => {
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(new Error('TimeoutError'));
      await expect(adapter.readRange('uploads/x', 16)).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('delete', () => {
    it('sends DeleteObjectCommand on success', async () => {
      const send = mockSend(adapter);
      send.mockResolvedValueOnce({});
      await adapter.delete('uploads/x');
      expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    });

    it('wraps errors as DomainException', async () => {
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(new Error('AccessDenied'));
      await expect(adapter.delete('uploads/x')).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('finalize', () => {
    it('copies the exact staging version to the final key and deletes the source', async () => {
      const send = mockSend(adapter);
      send.mockResolvedValue({});
      await adapter.finalize('uploads/user/x.png', 'files/user/y.png', '"etag-1"');
      const cmd = send.mock.calls[0][0] as CopyObjectCommand;
      expect(cmd).toBeInstanceOf(CopyObjectCommand);
      expect(cmd.input).toMatchObject({
        Bucket: 'uploads',
        Key: 'files/user/y.png',
        CopySource: 'uploads/uploads/user/x.png',
        CopySourceIfMatch: '"etag-1"',
      });
      expect(send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
    });

    it('wraps errors as DomainException', async () => {
      const send = mockSend(adapter);
      send.mockRejectedValueOnce(new Error('AccessDenied'));
      await expect(
        adapter.finalize('uploads/user/x.png', 'files/user/y.png', '"etag-1"'),
      ).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('getSignedUrl', () => {
    it('returns the signed URL from the presigner helper', async () => {
      const url = await adapter.getSignedUrl('uploads/x', 60);
      expect(url).toMatch(/X-Amz-/);
    });
  });

  describe('presignUpload', () => {
    it('returns the presigned POST envelope', async () => {
      const result = await adapter.presignUpload('uploads/x', {
        contentType: 'image/png',
        maxBytes: 1024,
      });
      expect(result.url).toBe('https://s3.example/uploads');
      expect(result.key).toBe('uploads/x');
      expect(result.bucket).toBe('uploads');
      expect(result.maxBytes).toBe(1024);
      expect(Date.parse(result.expiresAt)).not.toBeNaN();
    });

    // A `tagging` field inside a POST policy is a MinIO/AWS extension. SeaweedFS answers
    // `Policy Condition failed`, which made the whole presign flow unusable there.
    it('signs a policy no S3-compatible backend can reject over tagging', async () => {
      await adapter.presignUpload('uploads/x', { contentType: 'image/png', maxBytes: 1024 });

      const [, params] = vi.mocked(createPresignedPost).mock.calls.at(-1) as [unknown, PostParams];
      expect(params.Fields).not.toHaveProperty('tagging');
      expect(JSON.stringify(params.Conditions)).not.toContain('tagging');
    });
  });

  describe('backend compatibility switches', () => {
    it('defaults to path-style addressing and SDK checksums', async () => {
      const client = await resolvedClientConfig(new S3StorageAdapter(makeConfigService()));

      expect(client.forcePathStyle).toBe(true);
      expect(client.requestChecksumCalculation).toBe('WHEN_SUPPORTED');
    });

    // Backends that reject `x-amz-checksum-crc32` (older Ceph RGW, B2) need the SDK to stop
    // sending it; AWS documents WHEN_REQUIRED as the way to do that.
    it('stops sending upload checksums when STORAGE_CHECKSUM_MODE says so', async () => {
      const client = await resolvedClientConfig(
        new S3StorageAdapter(makeConfigService({ STORAGE_CHECKSUM_MODE: 'WHEN_REQUIRED' })),
      );

      expect(client.requestChecksumCalculation).toBe('WHEN_REQUIRED');
    });

    it('switches to virtual-hosted addressing for real AWS S3', async () => {
      const client = await resolvedClientConfig(
        new S3StorageAdapter(makeConfigService({ STORAGE_FORCE_PATH_STYLE: 'false' })),
      );

      expect(client.forcePathStyle).toBe(false);
    });

    it('rejects an unknown checksum mode at construction', () => {
      expect(
        () => new S3StorageAdapter(makeConfigService({ STORAGE_CHECKSUM_MODE: 'sometimes' })),
      ).toThrow(/STORAGE_CHECKSUM_MODE/);
    });
  });
});
