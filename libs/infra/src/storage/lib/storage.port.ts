import type { Readable } from 'node:stream';
import type { StoredFileStatus } from '@nestjs-fastify-nx/shared';

export interface UploadOptions {
  bucket?: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StreamUploadOptions extends UploadOptions {
  size: number;
  signal?: AbortSignal;
}

export interface StoredFile {
  status?: StoredFileStatus;
  id?: string;
  key: string;
  // Present only after asynchronous malware verification reaches READY.
  url?: string;
  bucket: string;
  size: number;
}

export interface ObjectMetadata {
  contentType: string;
  size: number;
  bucket: string;
  etag: string;
}

export interface PresignedUpload {
  // Browser POSTs the file to this URL with `fields` as multipart form parts.
  url: string;
  fields: Record<string, string>;
  key: string;
  bucket: string;
  expiresAt: string;
  maxBytes: number;
}

export interface PresignUploadOptions {
  bucket?: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds?: number;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');

export interface StorageReadStream extends AsyncIterable<Uint8Array> {
  // The caller must close even when it never starts iterating (e.g. a skipped scan).
  close(): void;
}

export interface StoragePort {
  uploadStream(key: string, body: Readable, options: StreamUploadOptions): Promise<StoredFile>;
  presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload>;
  head(key: string, bucket?: string): Promise<ObjectMetadata | null>;
  getSignedUrl(key: string, expiresIn?: number, bucket?: string): Promise<string>;
  delete(key: string, bucket?: string): Promise<void>;
  // Copy a validated staging object to a fresh final key. The source ETag precondition closes
  // the HEAD/read/copy race; callers must generate a new final key for every confirmation.
  finalize(
    sourceKey: string,
    finalKey: string,
    expectedEtag: string,
    bucket?: string,
  ): Promise<void>;
  // Read the first `byteCount` bytes of the object — used by the async
  // magic-byte verifier so the worker doesn't have to download whole files.
  readRange(key: string, byteCount: number, bucket?: string): Promise<Buffer>;
  // Streamed read for the malware scanner. Uploads are capped in the hundreds of megabytes upward,
  // so the whole object is never materialised as one Buffer.
  readStream(key: string, bucket?: string): Promise<StorageReadStream>;
}
