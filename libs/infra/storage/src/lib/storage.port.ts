export interface UploadOptions {
  bucket?: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoredFile {
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

export interface StoragePort {
  upload(key: string, body: Buffer, options?: UploadOptions): Promise<StoredFile>;
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
  // Complete quarantined object for malware scanning; it remains unavailable until scan success.
  // Only for objects known to be small — it materialises the whole body in memory.
  read(key: string, bucket?: string): Promise<Buffer>;
  // The same bytes as `read`, streamed. Uploads are capped in the hundreds of megabytes upward,
  // so the scanner consumes this instead: one 10 GB object would otherwise be one 10 GB Buffer.
  readStream(key: string, bucket?: string): Promise<AsyncIterable<Uint8Array>>;
}
