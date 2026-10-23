import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { generateId } from '@nestjs-fastify-nx/shared';
import type {
  ObjectMetadata,
  PresignedUpload,
  PresignUploadOptions,
  StoragePort,
  StorageReadStream,
  StoredFile,
  StreamUploadOptions,
} from './storage.port';
import { STORAGE_FAILURES, storageFailure, type StorageFailureContract } from './storage-failure';

export const LOCAL_STORAGE_CONTROLLER_PATH = 'storage/local';
export const LOCAL_STORAGE_UPLOAD_ROUTE = 'uploads';
export const LOCAL_STORAGE_DOWNLOAD_ROUTE = 'objects';

export const LOCAL_UPLOAD_FIELDS = {
  key: 'key',
  bucket: 'bucket',
  contentType: 'Content-Type',
  maxBytes: 'max-bytes',
  expires: 'expires',
  signature: 'signature',
} as const;

export interface LocalDownloadRequest {
  readonly bucket: string;
  readonly key: string;
  readonly expires: number;
  readonly signature: string;
}

export interface LocalDownload {
  readonly stream: Readable;
  readonly contentType: string;
  readonly size: number;
}

interface ObjectLocation {
  readonly objectPath: string;
  readonly metaPath: string;
}

interface StoredMeta {
  readonly contentType: string;
  readonly size: number;
  readonly etag: string;
}

interface WriteLimits {
  readonly minBytes: number;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

const PUBLIC_API_PREFIX = '/api/v1';
const DEFAULT_PRESIGN_EXPIRY_SECONDS = 300;
const MIN_SIGNING_SECRET_LENGTH = 32;
const DEV_SIGNING_SECRET = 'local-storage-development-signing-secret';
const DEV_PUBLIC_ENDPOINT = 'http://localhost:3000';
const DEFAULT_ROOT = 'storage';
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OBJECTS_DIR = 'objects';
const META_DIR = 'meta';
const TMP_DIR = 'tmp';
const MS_PER_SECOND = 1000;

class ObjectSizeOutOfRange extends Error {}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isStoredMeta(value: unknown): value is StoredMeta {
  const candidate = value as Partial<StoredMeta> | null;
  return (
    typeof candidate?.contentType === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.etag === 'string'
  );
}

function nowSeconds(): number {
  return Math.floor(Date.now() / MS_PER_SECOND);
}

function signingDenied(message: string): DomainException {
  return new DomainException({
    kind: 'forbidden',
    code: ERROR_CODES.FORBIDDEN,
    title: I18N_KEYS.common.forbidden,
    violations: [{ path: 'signature', code: 'signature_invalid', message }],
  });
}

function malformedUpload(path: string, message: string): DomainException {
  return new DomainException({
    kind: 'malformed',
    code: ERROR_CODES.BAD_REQUEST,
    title: I18N_KEYS.common.bad_request,
    violations: [{ path, code: 'field_invalid', message }],
  });
}

function sizeOutOfRange(maxBytes: number): DomainException {
  return new DomainException({
    kind: 'validation',
    code: ERROR_CODES.UPLOAD_SIZE_OUT_OF_RANGE,
    messageKey: I18N_KEYS.errors.upload.size_out_of_range,
    violations: [
      {
        path: 'file',
        code: 'size_out_of_range',
        message: `Object size is outside the allowed range (1..${maxBytes})`,
        messageKey: I18N_KEYS.errors.upload.size_out_of_range,
      },
    ],
  });
}

export function requireLocalStorage(storage: StoragePort): LocalStorageAdapter {
  if (storage instanceof LocalStorageAdapter) return storage;
  throw new Error('Local storage routes require STORAGE_DRIVER=local');
}

@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly root: string;
  private readonly bucket: string;
  private readonly downloadUrlExpiresSeconds: number;

  constructor(private readonly config: ConfigService) {
    this.root = resolve(this.config.get<string>('STORAGE_LOCAL_ROOT') || DEFAULT_ROOT);
    this.bucket = this.config.get<string>('STORAGE_BUCKET') || 'uploads';
    this.downloadUrlExpiresSeconds = this.config.get<number>(
      'STORAGE_DOWNLOAD_URL_EXPIRES_SECONDS',
      3_600,
    );
  }

  async uploadStream(
    key: string,
    body: Readable,
    options: StreamUploadOptions,
  ): Promise<StoredFile> {
    const bucket = options.bucket ?? this.bucket;
    try {
      if (!Number.isSafeInteger(options.size) || options.size <= 0) {
        throw new RangeError('Stream upload size must be a positive safe integer');
      }
      options.signal?.throwIfAborted();
      await this.writeObject(this.locate(bucket, key), body, options.contentType, {
        minBytes: options.size,
        maxBytes: options.size,
        signal: options.signal,
      });
      return { key, bucket, size: options.size };
    } catch (err) {
      throw this.failure(STORAGE_FAILURES.upload, { key }, err);
    } finally {
      body.destroy();
    }
  }

  presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
    const bucket = options.bucket ?? this.bucket;
    const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS;
    try {
      this.locate(bucket, key);
      const expires = nowSeconds() + expiresInSeconds;
      const signature = this.sign(
        this.uploadPayload(bucket, key, options.contentType, options.maxBytes, expires),
      );
      return Promise.resolve({
        url: this.publicUrl(LOCAL_STORAGE_UPLOAD_ROUTE),
        fields: {
          [LOCAL_UPLOAD_FIELDS.key]: key,
          [LOCAL_UPLOAD_FIELDS.bucket]: bucket,
          [LOCAL_UPLOAD_FIELDS.contentType]: options.contentType,
          [LOCAL_UPLOAD_FIELDS.maxBytes]: String(options.maxBytes),
          [LOCAL_UPLOAD_FIELDS.expires]: String(expires),
          [LOCAL_UPLOAD_FIELDS.signature]: signature,
        },
        key,
        bucket,
        expiresAt: new Date(expires * MS_PER_SECOND).toISOString(),
        maxBytes: options.maxBytes,
      });
    } catch (err) {
      return Promise.reject(this.failure(STORAGE_FAILURES.presign, { key }, err));
    }
  }

  async head(key: string, bucket?: string): Promise<ObjectMetadata | null> {
    const targetBucket = bucket ?? this.bucket;
    try {
      const meta = await this.readMeta(this.locate(targetBucket, key));
      return meta ? { ...meta, bucket: targetBucket } : null;
    } catch (err) {
      throw this.failure(STORAGE_FAILURES.head, { key }, err);
    }
  }

  getSignedUrl(
    key: string,
    expiresIn = this.downloadUrlExpiresSeconds,
    bucket?: string,
  ): Promise<string> {
    const targetBucket = bucket ?? this.bucket;
    try {
      this.locate(targetBucket, key);
      const expires = nowSeconds() + expiresIn;
      const query = new URLSearchParams({
        bucket: targetBucket,
        key,
        expires: String(expires),
        signature: this.sign(this.downloadPayload(targetBucket, key, expires)),
      });
      return Promise.resolve(`${this.publicUrl(LOCAL_STORAGE_DOWNLOAD_ROUTE)}?${query.toString()}`);
    } catch (err) {
      return Promise.reject(this.failure(STORAGE_FAILURES.signedUrl, { key }, err));
    }
  }

  async delete(key: string, bucket?: string): Promise<void> {
    try {
      await this.removeObject(this.locate(bucket ?? this.bucket, key));
    } catch (err) {
      throw this.failure(STORAGE_FAILURES.delete, { key }, err);
    }
  }

  async finalize(
    sourceKey: string,
    finalKey: string,
    expectedEtag: string,
    bucket?: string,
  ): Promise<void> {
    const targetBucket = bucket ?? this.bucket;
    try {
      const source = this.locate(targetBucket, sourceKey);
      const target = this.locate(targetBucket, finalKey);
      const meta = await this.readMeta(source);
      if (!meta || meta.etag !== expectedEtag) {
        throw new Error('Source object is missing or no longer matches the confirmed ETag');
      }
      const claimed = await this.tempPath();
      await rename(source.objectPath, claimed);
      try {
        const etag = await this.digestFile(claimed);
        if (etag !== expectedEtag) {
          throw new Error('Source object changed before it could be finalized');
        }
        await this.commit(claimed, target, meta);
        await unlink(source.metaPath).catch((err: unknown) => {
          if (!isMissing(err)) throw err;
        });
      } finally {
        await this.discard(claimed);
      }
    } catch (err) {
      throw this.failure(STORAGE_FAILURES.finalize, { sourceKey, finalKey }, err);
    }
  }

  async readRange(key: string, byteCount: number, bucket?: string): Promise<Buffer> {
    try {
      const handle = await open(this.locate(bucket ?? this.bucket, key).objectPath, 'r');
      try {
        const buffer = Buffer.alloc(Math.max(0, byteCount));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch (err) {
      throw this.failure(STORAGE_FAILURES.readRange, { key, byteCount }, err);
    }
  }

  async readStream(key: string, bucket?: string): Promise<StorageReadStream> {
    try {
      const stream = await this.openStream(this.locate(bucket ?? this.bucket, key).objectPath);
      return {
        [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>,
        close: () => {
          stream.destroy();
        },
      };
    } catch (err) {
      throw this.failure(STORAGE_FAILURES.readStream, { key }, err);
    }
  }

  async acceptPresignedUpload(fields: Record<string, string>, body: Readable): Promise<void> {
    try {
      const key = this.requireField(fields, LOCAL_UPLOAD_FIELDS.key);
      const bucket = this.requireField(fields, LOCAL_UPLOAD_FIELDS.bucket);
      const contentType = this.requireField(fields, LOCAL_UPLOAD_FIELDS.contentType);
      const maxBytes = this.requireInteger(fields, LOCAL_UPLOAD_FIELDS.maxBytes);
      const expires = this.requireInteger(fields, LOCAL_UPLOAD_FIELDS.expires);
      const signature = this.requireField(fields, LOCAL_UPLOAD_FIELDS.signature);
      this.verify(this.uploadPayload(bucket, key, contentType, maxBytes, expires), signature);
      this.assertNotExpired(expires);
      try {
        await this.writeObject(this.locate(bucket, key), body, contentType, {
          minBytes: 1,
          maxBytes,
        });
      } catch (err) {
        if (err instanceof ObjectSizeOutOfRange) throw sizeOutOfRange(maxBytes);
        throw err;
      }
    } catch (err) {
      if (err instanceof DomainException) throw err;
      throw this.failure(STORAGE_FAILURES.upload, {}, err);
    } finally {
      body.resume();
    }
  }

  async openSignedDownload(request: LocalDownloadRequest): Promise<LocalDownload | null> {
    this.verify(
      this.downloadPayload(request.bucket, request.key, request.expires),
      request.signature,
    );
    this.assertNotExpired(request.expires);
    try {
      const location = this.locate(request.bucket, request.key);
      const meta = await this.readMeta(location);
      if (!meta) return null;
      const stream = await this.openStream(location.objectPath);
      return { stream, contentType: meta.contentType, size: meta.size };
    } catch (err) {
      if (isMissing(err)) return null;
      throw this.failure(STORAGE_FAILURES.readStream, { key: request.key }, err);
    }
  }

  async deleteObjectsOlderThan(prefix: string, cutoff: Date): Promise<number> {
    const bucketRoot = join(this.root, OBJECTS_DIR, this.bucket);
    const expiredObjects = await this.collectOlderThan(
      join(bucketRoot, ...this.segments(this.bucket, prefix)),
      cutoff,
    );
    for (const objectPath of expiredObjects) {
      const key = objectPath
        .slice(bucketRoot.length + 1)
        .split(sep)
        .join('/');
      await this.removeObject(this.locate(this.bucket, key));
    }
    const expiredTemps = await this.collectOlderThan(join(this.root, TMP_DIR), cutoff);
    for (const tempPath of expiredTemps) await this.discard(tempPath);
    return expiredObjects.length;
  }

  private failure(
    failure: StorageFailureContract,
    ctx: Record<string, unknown>,
    err: unknown,
  ): Error {
    return storageFailure(this.logger, failure, { ...ctx, driver: 'local' }, err);
  }

  private segments(bucket: string, key: string): string[] {
    const segments = key.split('/');
    if (!SEGMENT_PATTERN.test(bucket) || !segments.every((s) => SEGMENT_PATTERN.test(s))) {
      throw new Error(`Invalid local storage location "${bucket}/${key}"`);
    }
    return segments;
  }

  private locate(bucket: string, key: string): ObjectLocation {
    const segments = this.segments(bucket, key);
    return {
      objectPath: join(this.root, OBJECTS_DIR, bucket, ...segments),
      metaPath: `${join(this.root, META_DIR, bucket, ...segments)}.json`,
    };
  }

  private async writeObject(
    location: ObjectLocation,
    body: Readable,
    contentType: string | undefined,
    limits: WriteLimits,
  ): Promise<void> {
    const temp = await this.tempPath();
    try {
      const hash = createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size > limits.maxBytes) {
            callback(new ObjectSizeOutOfRange());
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(body, meter, createWriteStream(temp, { flags: 'wx', mode: 0o600 }), {
        signal: limits.signal,
      });
      if (size < limits.minBytes) throw new ObjectSizeOutOfRange();
      await this.commit(temp, location, {
        contentType: contentType ?? 'application/octet-stream',
        size,
        etag: `"${hash.digest('hex')}"`,
      });
    } finally {
      await this.discard(temp);
    }
  }

  private async commit(temp: string, location: ObjectLocation, meta: StoredMeta): Promise<void> {
    await mkdir(dirname(location.objectPath), { recursive: true });
    await mkdir(dirname(location.metaPath), { recursive: true });
    const metaTemp = await this.tempPath();
    await writeFile(metaTemp, JSON.stringify(meta), { flag: 'wx', mode: 0o600 });
    await rename(metaTemp, location.metaPath);
    await rename(temp, location.objectPath);
  }

  private async readMeta(location: ObjectLocation): Promise<StoredMeta | null> {
    try {
      await stat(location.objectPath);
      const parsed: unknown = JSON.parse(await readFile(location.metaPath, 'utf8'));
      if (!isStoredMeta(parsed)) {
        throw new Error(`Corrupt local storage metadata at "${location.metaPath}"`);
      }
      return parsed;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  private async removeObject(location: ObjectLocation): Promise<void> {
    for (const path of [location.objectPath, location.metaPath]) {
      await unlink(path).catch((err: unknown) => {
        if (!isMissing(err)) throw err;
      });
    }
  }

  private async tempPath(): Promise<string> {
    const directory = join(this.root, TMP_DIR);
    await mkdir(directory, { recursive: true });
    return join(directory, generateId());
  }

  private async discard(path: string): Promise<void> {
    await unlink(path).catch((err: unknown) => {
      if (isMissing(err)) return;
      this.logger.warn({ err, path }, 'local storage temporary file cleanup failed');
    });
  }

  private async digestFile(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return `"${hash.digest('hex')}"`;
  }

  private openStream(path: string): Promise<ReadStream> {
    return new Promise((resolveStream, rejectStream) => {
      const stream = createReadStream(path);
      stream.once('open', () => {
        stream.off('error', rejectStream);
        resolveStream(stream);
      });
      stream.once('error', rejectStream);
    });
  }

  private async collectOlderThan(directory: string, cutoff: Date): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(
      (err: unknown) => {
        if (isMissing(err)) return [];
        throw err;
      },
    );
    const expired: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const info = await stat(path).catch((err: unknown) => {
        if (isMissing(err)) return null;
        throw err;
      });
      if (info && info.mtime < cutoff) expired.push(path);
    }
    return expired;
  }

  private uploadPayload(
    bucket: string,
    key: string,
    contentType: string,
    maxBytes: number,
    expires: number,
  ): string {
    return ['upload', bucket, key, contentType, maxBytes, expires].join('\n');
  }

  private downloadPayload(bucket: string, key: string, expires: number): string {
    return ['download', bucket, key, expires].join('\n');
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.signingSecret()).update(payload).digest('base64url');
  }

  private verify(payload: string, signature: string): void {
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw signingDenied('Signature does not match the requested object');
    }
  }

  private assertNotExpired(expires: number): void {
    if (expires < nowSeconds()) throw signingDenied('Signed URL has expired');
  }

  private requireField(fields: Record<string, string>, name: string): string {
    const value = fields[name];
    if (!value) throw malformedUpload(name, `Form field "${name}" is required`);
    return value;
  }

  private requireInteger(fields: Record<string, string>, name: string): number {
    const value = Number(this.requireField(fields, name));
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw malformedUpload(name, `Form field "${name}" must be a positive integer`);
    }
    return value;
  }

  private publicUrl(route: string): string {
    const endpoint = this.requireSetting('STORAGE_PUBLIC_ENDPOINT', DEV_PUBLIC_ENDPOINT);
    return `${endpoint.replace(/\/+$/, '')}${PUBLIC_API_PREFIX}/${LOCAL_STORAGE_CONTROLLER_PATH}/${route}`;
  }

  private signingSecret(): string {
    const secret = this.requireSetting('STORAGE_LOCAL_SIGNING_SECRET', DEV_SIGNING_SECRET);
    if (secret.length < MIN_SIGNING_SECRET_LENGTH) {
      throw new Error(
        `STORAGE_LOCAL_SIGNING_SECRET must be at least ${MIN_SIGNING_SECRET_LENGTH} characters`,
      );
    }
    return secret;
  }

  private requireSetting(key: string, devDefault: string): string {
    const value = this.config.get<string>(key);
    if (value) return value;
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(`StorageModule: required env var "${key}" is not set`);
    }
    return devDefault;
  }
}
