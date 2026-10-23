import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import {
  LocalStorageAdapter,
  LOCAL_UPLOAD_FIELDS,
  requireLocalStorage,
} from './local-storage.adapter';
import type { StoragePort } from './storage.port';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PUBLIC_ENDPOINT = 'https://api.example.test';
const SECRET = 'x'.repeat(48);

function configFor(root: string): ConfigService {
  const values: Record<string, unknown> = {
    STORAGE_LOCAL_ROOT: root,
    STORAGE_BUCKET: 'uploads',
    STORAGE_PUBLIC_ENDPOINT: PUBLIC_ENDPOINT,
    STORAGE_LOCAL_SIGNING_SECRET: SECRET,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function expectDomainError(
  promise: Promise<unknown>,
  expected: { kind: string; code: string },
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainException);
  const domain = error as DomainException;
  expect({ kind: domain.kind, code: domain.code }).toEqual(expected);
}

describe('LocalStorageAdapter', () => {
  let root: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'local-storage-'));
    adapter = new LocalStorageAdapter(configFor(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function presignAndUpload(key: string, body: Buffer): Promise<void> {
    const presigned = await adapter.presignUpload(key, {
      contentType: 'image/png',
      maxBytes: 1024,
    });
    await adapter.acceptPresignedUpload(presigned.fields, Readable.from([body]));
  }

  it('stores a streamed object and reports its metadata, bytes and range', async () => {
    await adapter.uploadStream('files/u1/a.png', Readable.from([PNG]), {
      contentType: 'image/png',
      size: PNG.length,
    });

    const meta = await adapter.head('files/u1/a.png');
    expect(meta).toMatchObject({ contentType: 'image/png', size: PNG.length, bucket: 'uploads' });
    expect(meta?.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await adapter.readRange('files/u1/a.png', 4)).toEqual(PNG.subarray(0, 4));
    const stream = await adapter.readStream('files/u1/a.png');
    expect(await collect(stream)).toEqual(PNG);
    stream.close();
  });

  it('rejects a streamed object whose length differs from the declared size', async () => {
    await expectDomainError(
      adapter.uploadStream('files/u1/a.png', Readable.from([PNG]), {
        contentType: 'image/png',
        size: PNG.length + 1,
      }),
      { kind: 'unavailable', code: ERROR_CODES.STORAGE_UPLOAD_FAILED },
    );
    expect(await adapter.head('files/u1/a.png')).toBeNull();
  });

  it('returns null from head for an object that was never written', async () => {
    expect(await adapter.head('files/u1/missing.png')).toBeNull();
  });

  it('issues a presigned form that targets the public API origin', async () => {
    const presigned = await adapter.presignUpload('uploads/u1/a.png', {
      contentType: 'image/png',
      maxBytes: 1024,
    });

    expect(presigned.url).toBe(`${PUBLIC_ENDPOINT}/api/v1/storage/local/uploads`);
    expect(presigned.fields).toMatchObject({
      [LOCAL_UPLOAD_FIELDS.key]: 'uploads/u1/a.png',
      [LOCAL_UPLOAD_FIELDS.contentType]: 'image/png',
      [LOCAL_UPLOAD_FIELDS.maxBytes]: '1024',
    });
  });

  it('accepts a correctly signed upload and pins the signed content type', async () => {
    await presignAndUpload('uploads/u1/a.png', PNG);

    expect(await adapter.head('uploads/u1/a.png')).toMatchObject({
      contentType: 'image/png',
      size: PNG.length,
    });
  });

  it('rejects an upload whose signed fields were tampered with', async () => {
    const presigned = await adapter.presignUpload('uploads/u1/a.png', {
      contentType: 'image/png',
      maxBytes: 1024,
    });
    const tampered = { ...presigned.fields, [LOCAL_UPLOAD_FIELDS.key]: 'uploads/u2/a.png' };

    await expectDomainError(adapter.acceptPresignedUpload(tampered, Readable.from([PNG])), {
      kind: 'forbidden',
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(await adapter.head('uploads/u2/a.png')).toBeNull();
  });

  it('rejects an expired upload policy', async () => {
    const presigned = await adapter.presignUpload('uploads/u1/a.png', {
      contentType: 'image/png',
      maxBytes: 1024,
      expiresInSeconds: -10,
    });

    await expectDomainError(adapter.acceptPresignedUpload(presigned.fields, Readable.from([PNG])), {
      kind: 'forbidden',
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('rejects an upload larger than the signed cap without leaving a partial object', async () => {
    const presigned = await adapter.presignUpload('uploads/u1/a.png', {
      contentType: 'image/png',
      maxBytes: 4,
    });

    await expectDomainError(adapter.acceptPresignedUpload(presigned.fields, Readable.from([PNG])), {
      kind: 'validation',
      code: ERROR_CODES.UPLOAD_SIZE_OUT_OF_RANGE,
    });
    expect(await adapter.head('uploads/u1/a.png')).toBeNull();
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('rejects a form missing a signed field as malformed', async () => {
    await expectDomainError(adapter.acceptPresignedUpload({}, Readable.from([PNG])), {
      kind: 'malformed',
      code: ERROR_CODES.BAD_REQUEST,
    });
  });

  it('finalizes a staged object to its final key only when the ETag still matches', async () => {
    await presignAndUpload('uploads/u1/a.png', PNG);
    const staged = await adapter.head('uploads/u1/a.png');

    await adapter.finalize('uploads/u1/a.png', 'files/u1/final.png', staged?.etag ?? '');

    expect(await adapter.head('uploads/u1/a.png')).toBeNull();
    expect(await adapter.head('files/u1/final.png')).toMatchObject({
      etag: staged?.etag,
      contentType: 'image/png',
    });
  });

  it('refuses to finalize when the staged object no longer matches the confirmed ETag', async () => {
    await presignAndUpload('uploads/u1/a.png', PNG);

    await expectDomainError(adapter.finalize('uploads/u1/a.png', 'files/u1/final.png', '"stale"'), {
      kind: 'unavailable',
      code: ERROR_CODES.STORAGE_FINALIZE_FAILED,
    });
    expect(await adapter.head('uploads/u1/a.png')).not.toBeNull();
    expect(await adapter.head('files/u1/final.png')).toBeNull();
  });

  it('serves a signed download and refuses a forged one', async () => {
    await presignAndUpload('uploads/u1/a.png', PNG);
    const url = new URL(await adapter.getSignedUrl('uploads/u1/a.png', 60));
    const request = {
      bucket: url.searchParams.get('bucket') ?? '',
      key: url.searchParams.get('key') ?? '',
      expires: Number(url.searchParams.get('expires')),
      signature: url.searchParams.get('signature') ?? '',
    };

    expect(url.pathname).toBe('/api/v1/storage/local/objects');
    const download = await adapter.openSignedDownload(request);
    expect(download).toMatchObject({ contentType: 'image/png', size: PNG.length });
    expect(await collect(download?.stream ?? Readable.from([]))).toEqual(PNG);

    await expect(
      adapter.openSignedDownload({ ...request, key: 'uploads/u1/other.png' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('returns null for a validly signed download of a deleted object', async () => {
    await presignAndUpload('uploads/u1/a.png', PNG);
    const url = new URL(await adapter.getSignedUrl('uploads/u1/a.png', 60));
    await adapter.delete('uploads/u1/a.png');

    expect(
      await adapter.openSignedDownload({
        bucket: 'uploads',
        key: 'uploads/u1/a.png',
        expires: Number(url.searchParams.get('expires')),
        signature: url.searchParams.get('signature') ?? '',
      }),
    ).toBeNull();
  });

  it('treats deleting a missing object as success', async () => {
    await expect(adapter.delete('files/u1/missing.png')).resolves.toBeUndefined();
  });

  it('rejects keys that would escape the storage root', async () => {
    await expect(adapter.head('../etc/passwd')).rejects.toBeInstanceOf(DomainException);
    await expect(adapter.head('files/../../secret')).rejects.toBeInstanceOf(DomainException);
  });

  it('expires only staging objects older than the cutoff', async () => {
    await presignAndUpload('uploads/u1/old.png', PNG);
    await presignAndUpload('uploads/u1/new.png', PNG);
    await adapter.uploadStream('files/u1/kept.png', Readable.from([PNG]), {
      contentType: 'image/png',
      size: PNG.length,
    });
    const past = new Date('2020-01-01T00:00:00.000Z');
    await utimes(join(root, 'objects', 'uploads', 'uploads', 'u1', 'old.png'), past, past);
    await utimes(join(root, 'objects', 'uploads', 'files', 'u1', 'kept.png'), past, past);

    const deleted = await adapter.deleteObjectsOlderThan(
      'uploads',
      new Date('2021-01-01T00:00:00.000Z'),
    );

    expect(deleted).toBe(1);
    expect(await adapter.head('uploads/u1/old.png')).toBeNull();
    expect(await adapter.head('uploads/u1/new.png')).not.toBeNull();
    expect(await adapter.head('files/u1/kept.png')).not.toBeNull();
  });

  it('returns zero when the staging prefix does not exist yet', async () => {
    expect(await adapter.deleteObjectsOlderThan('uploads', new Date())).toBe(0);
  });

  it('narrows a storage port to the local adapter and refuses any other driver', () => {
    expect(requireLocalStorage(adapter)).toBe(adapter);
    expect(() => requireLocalStorage({} as StoragePort)).toThrow(/STORAGE_DRIVER=local/);
  });
});
