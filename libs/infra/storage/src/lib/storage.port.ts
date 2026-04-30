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

export const STORAGE_PORT = Symbol('STORAGE_PORT');

export interface StoragePort {
  upload(key: string, body: Buffer, options?: UploadOptions): Promise<StoredFile>;
  getSignedUrl(key: string, expiresIn?: number, bucket?: string): Promise<string>;
  delete(key: string, bucket?: string): Promise<void>;
}
