export interface UploadOptions {
  bucket?: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoredFile {
  key: string;
  url: string;
  bucket: string;
  size: number;
}

export interface ObjectMetadata {
  contentType: string;
  size: number;
  bucket: string;
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
}
