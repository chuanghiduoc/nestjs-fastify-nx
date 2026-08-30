import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type {
  ObjectMetadata,
  PresignedUpload,
  PresignUploadOptions,
  StoragePort,
  StoredFile,
  UploadOptions,
} from './storage.port';

type ChecksumMode = 'WHEN_SUPPORTED' | 'WHEN_REQUIRED';

const CHECKSUM_MODES: readonly ChecksumMode[] = ['WHEN_SUPPORTED', 'WHEN_REQUIRED'];

const DEFAULT_PRESIGN_EXPIRY_SECONDS = 300;
const SDK_MAX_ATTEMPTS = 3;
const ABSENT_BUCKET_CODES = ['NotFound', 'NoSuchBucket'] as const;
const ABSENT_OBJECT_CODES = ['NotFound', 'NoSuchKey'] as const;

const FAILURES = {
  upload: {
    code: ERROR_CODES.STORAGE_UPLOAD_FAILED,
    messageKey: I18N_KEYS.errors.storage.upload_failed,
    message: 'Storage upload failed',
    log: 'S3 upload failed',
  },
  presign: {
    code: ERROR_CODES.STORAGE_PRESIGN_FAILED,
    messageKey: I18N_KEYS.errors.storage.presign_failed,
    message: 'Storage presign failed',
    log: 'S3 presign upload failed',
  },
  head: {
    code: ERROR_CODES.STORAGE_HEAD_FAILED,
    messageKey: I18N_KEYS.errors.storage.head_failed,
    message: 'Storage head failed',
    log: 'S3 head failed',
  },
  signedUrl: {
    code: ERROR_CODES.STORAGE_SIGNED_URL_FAILED,
    messageKey: I18N_KEYS.errors.storage.signed_url_failed,
    message: 'Storage signed URL generation failed',
    log: 'S3 getSignedUrl failed',
  },
  delete: {
    code: ERROR_CODES.STORAGE_DELETE_FAILED,
    messageKey: I18N_KEYS.errors.storage.delete_failed,
    message: 'Storage delete failed',
    log: 'S3 delete failed',
  },
  finalize: {
    code: ERROR_CODES.STORAGE_FINALIZE_FAILED,
    messageKey: I18N_KEYS.errors.storage.commit_failed,
    message: 'Storage finalize failed; retry confirmation',
    log: 'S3 finalize copy failed',
  },
  readRange: {
    code: ERROR_CODES.STORAGE_READ_FAILED,
    messageKey: I18N_KEYS.errors.storage.read_range_failed,
    message: 'Storage readRange failed',
    log: 'S3 readRange failed',
  },
  readStream: {
    code: ERROR_CODES.STORAGE_READ_FAILED,
    messageKey: I18N_KEYS.errors.storage.read_range_failed,
    message: 'Storage readStream failed',
    log: 'S3 readStream failed',
  },
  read: {
    code: ERROR_CODES.STORAGE_READ_FAILED,
    messageKey: I18N_KEYS.errors.storage.read_range_failed,
    message: 'Storage read failed',
    log: 'S3 full-object read failed',
  },
} as const satisfies Record<string, FailureContract>;

interface FailureContract {
  readonly code: string;
  readonly messageKey: string;
  readonly message: string;
  readonly log: string;
}

function assertByteArray(body: unknown): { transformToByteArray: () => Promise<Uint8Array> } {
  const candidate = body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!candidate?.transformToByteArray) {
    throw new Error('S3 GetObject returned no readable body');
  }
  return candidate as { transformToByteArray: () => Promise<Uint8Array> };
}

function assertStream(body: unknown): AsyncIterable<Uint8Array> {
  const candidate = body as AsyncIterable<Uint8Array> | undefined;
  if (!candidate?.[Symbol.asyncIterator]) {
    throw new Error('S3 GetObject returned no streamable body');
  }
  return candidate;
}

function encodeCopySource(bucket: string, key: string): string {
  return [bucket, ...key.split('/')].map(encodeURIComponent).join('/');
}

@Injectable()
export class S3StorageAdapter implements StoragePort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly publicEndpoint: string;
  private readonly downloadUrlExpiresSeconds: number;

  constructor(private readonly config: ConfigService) {
    this.endpoint = this.requireConfig('STORAGE_ENDPOINT', 'http://localhost:9000');
    this.bucket = this.requireConfig('STORAGE_BUCKET', 'uploads');
    this.downloadUrlExpiresSeconds = this.config.get<number>(
      'STORAGE_DOWNLOAD_URL_EXPIRES_SECONDS',
      3_600,
    );

    const region = this.requireConfig('STORAGE_REGION', 'us-east-1');
    const accessKeyId = this.requireConfig('STORAGE_ACCESS_KEY', 'minioadmin');
    const secretAccessKey = this.requireConfig('STORAGE_SECRET_KEY', 'minioadmin');
    const credentials = { accessKeyId, secretAccessKey };

    // MinIO and most self-hosted backends only answer path-style; AWS S3 accepts both but documents
    // virtual-hosted as the supported form, so a deployment against real S3 can turn this off.
    const forcePathStyle = this.config.get<string>('STORAGE_FORCE_PATH_STYLE') !== 'false';
    // The SDK computes a CRC32 on every upload by default (WHEN_SUPPORTED). AWS S3 and current
    // MinIO accept it; older Ceph RGW, Backblaze B2 and some gateways reject the header outright,
    // and WHEN_REQUIRED is the documented way to stop sending it.
    const requestChecksumCalculation = this.resolveChecksumMode();
    const clientConfig = {
      region,
      credentials,
      forcePathStyle,
      maxAttempts: SDK_MAX_ATTEMPTS,
      requestChecksumCalculation,
      responseChecksumValidation: requestChecksumCalculation,
    };

    this.client = new S3Client({ ...clientConfig, endpoint: this.endpoint });

    // Presigned URLs must be signed against a host the browser can reach; in
    // containers STORAGE_ENDPOINT is internal (http://minio:9000), so
    // STORAGE_PUBLIC_ENDPOINT overrides it for signing. Unset means both equal.
    const configuredPublic = this.config.get<string>('STORAGE_PUBLIC_ENDPOINT');
    this.publicEndpoint = configuredPublic ? configuredPublic : this.endpoint;
    // Presigning is offline, so this client only shapes the signed host — it
    // never has to reach the public endpoint.
    this.presignClient =
      this.publicEndpoint === this.endpoint
        ? this.client
        : new S3Client({ ...clientConfig, endpoint: this.publicEndpoint });
  }

  private resolveChecksumMode(): ChecksumMode {
    const configured = this.config.get<string>('STORAGE_CHECKSUM_MODE')?.trim();
    if (!configured) {
      return 'WHEN_SUPPORTED';
    }
    if (!CHECKSUM_MODES.includes(configured as ChecksumMode)) {
      throw new Error(
        `StorageModule: STORAGE_CHECKSUM_MODE must be one of ${CHECKSUM_MODES.join(', ')}`,
      );
    }
    return configured as ChecksumMode;
  }

  // Development MinIO is bootstrapped automatically. Production storage is infrastructure-owned,
  // so the runtime identity needs no CreateBucket permission.
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      const code = (err as { name?: string })?.name;
      const missing =
        status === 404 ||
        ABSENT_BUCKET_CODES.includes(code as (typeof ABSENT_BUCKET_CODES)[number]);
      if (!missing) {
        // A non-404 (403, connection refused, TLS failure) means the bucket may well exist and we
        // simply cannot see it — creating it would be wrong, so surface the fault instead.
        const suffix = status === undefined ? '' : ` (status=${status})`;
        this.handleStartupFailure(err, `Bucket head check failed${suffix}`);
        return;
      }
    }

    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        `Storage bucket "${this.bucket}" does not exist; provision it outside the application`,
      );
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket "${this.bucket}"`);
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
        return;
      }
      this.handleStartupFailure(err, 'Failed to create storage bucket');
    }
  }

  // The SDK keeps a keep-alive HTTP agent with pooled sockets; without an explicit destroy they
  // survive shutdown and hold the event loop open (visible as a hung container on SIGTERM and as
  // leaked handles between test suites).
  onModuleDestroy(): void {
    this.client.destroy();
    // presignClient aliases client when no separate public endpoint is configured — destroying the
    // same client twice is not safe to assume, so only destroy a genuinely distinct instance.
    if (this.presignClient !== this.client) {
      this.presignClient.destroy();
    }
  }

  private handleStartupFailure(error: unknown, message: string): void {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(`StorageModule: ${message} for "${this.bucket}"`, { cause: error });
    }
    this.logger.warn({ err: error, bucket: this.bucket }, `${message} — continuing in dev`);
  }

  private requireConfig(key: string, devDefault: string): string {
    const value = this.config.get<string>(key);
    if (value === undefined || value === '') {
      if (process.env['NODE_ENV'] === 'production') {
        throw new Error(`StorageModule: required env var "${key}" is not set`);
      }
      this.logger.warn(`"${key}" not set — using dev default "${devDefault}"`);
      return devDefault;
    }
    return value;
  }

  private failure(
    failure: FailureContract,
    ctx: Record<string, unknown>,
    err: unknown,
  ): DomainException {
    this.logger.error({ err, ...ctx }, failure.log);
    return new DomainException({
      kind: 'unavailable',
      code: failure.code,
      permanent: false,
      messageKey: failure.messageKey,
      violations: [
        {
          path: 'storage',
          code: failure.code,
          message: failure.message,
          messageKey: failure.messageKey,
        },
      ],
    });
  }

  async upload(key: string, body: Buffer, options?: UploadOptions): Promise<StoredFile> {
    if (body.length === 0) {
      throw new DomainException({
        kind: 'validation',
        code: ERROR_CODES.STORAGE_BODY_EMPTY,
        messageKey: I18N_KEYS.errors.storage.body_empty,
        args: { key },
        violations: [
          {
            path: 'body',
            code: ERROR_CODES.STORAGE_BODY_EMPTY,
            message: `Upload rejected — body is empty for key "${key}"`,
            messageKey: I18N_KEYS.errors.storage.body_empty,
          },
        ],
      });
    }

    const bucket = options?.bucket ?? this.bucket;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: options?.contentType ?? 'application/octet-stream',
          ContentLength: body.length,
          Metadata: options?.metadata,
        }),
      );
    } catch (err) {
      throw this.failure(FAILURES.upload, { key }, err);
    }

    const url = `${this.publicEndpoint}/${bucket}/${key}`;

    return { key, bucket, url, size: body.length };
  }

  // POST policy pins Content-Type and size — prevents mime-type smuggling or oversized payloads.
  // It deliberately carries no `tagging` field: staging objects live under their own key prefix, so
  // the orphan-expiry lifecycle rule filters on that prefix instead. Tagging inside a POST policy is
  // a MinIO/AWS extension that SeaweedFS (and others) reject with `Policy Condition failed`.
  async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
    const bucket = options.bucket ?? this.bucket;
    const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS;

    try {
      const { url, fields } = await createPresignedPost(this.presignClient, {
        Bucket: bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, options.maxBytes],
          ['eq', '$Content-Type', options.contentType],
        ],
        Fields: { 'Content-Type': options.contentType },
        Expires: expiresInSeconds,
      });

      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
      return { url, fields, key, bucket, expiresAt, maxBytes: options.maxBytes };
    } catch (err) {
      throw this.failure(FAILURES.presign, { key }, err);
    }
  }

  // Null = object missing (not yet uploaded); throws on transport errors.
  async head(key: string, bucket?: string): Promise<ObjectMetadata | null> {
    const targetBucket = bucket ?? this.bucket;
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: targetBucket, Key: key }));
      if (!res.ETag) {
        throw new Error('S3 HeadObject returned no ETag');
      }
      return {
        contentType: res.ContentType ?? 'application/octet-stream',
        size: Number(res.ContentLength ?? 0),
        bucket: targetBucket,
        etag: res.ETag,
      };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      const name = (err as { name?: string })?.name;
      if (
        status === 404 ||
        ABSENT_OBJECT_CODES.includes(name as (typeof ABSENT_OBJECT_CODES)[number])
      ) {
        return null;
      }
      throw this.failure(FAILURES.head, { key }, err);
    }
  }

  async getSignedUrl(
    key: string,
    expiresIn = this.downloadUrlExpiresSeconds,
    bucket?: string,
  ): Promise<string> {
    const targetBucket = bucket ?? this.bucket;
    try {
      const command = new GetObjectCommand({
        Bucket: targetBucket,
        Key: key,
        // User-controlled files are served as downloads, never inline in the application origin.
        ResponseContentDisposition: 'attachment',
      });
      return await getSignedUrl(this.presignClient, command, { expiresIn });
    } catch (err) {
      throw this.failure(FAILURES.signedUrl, { key }, err);
    }
  }

  async delete(key: string, bucket?: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket ?? this.bucket,
          Key: key,
        }),
      );
    } catch (err) {
      throw this.failure(FAILURES.delete, { key }, err);
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
      await this.client.send(
        new CopyObjectCommand({
          Bucket: targetBucket,
          Key: finalKey,
          CopySource: encodeCopySource(targetBucket, sourceKey),
          CopySourceIfMatch: expectedEtag,
          MetadataDirective: 'COPY',
        }),
      );
    } catch (err) {
      throw this.failure(FAILURES.finalize, { sourceKey, finalKey }, err);
    }

    // The source keeps its staging prefix, so a delete failure is bounded by the lifecycle TTL.
    await this.delete(sourceKey, targetBucket).catch((err: unknown) => {
      this.logger.warn(
        { err, sourceKey, finalKey },
        'finalized upload but failed to remove staging object',
      );
    });
  }

  async readRange(key: string, byteCount: number, bucket?: string): Promise<Buffer> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket ?? this.bucket,
          Key: key,
          Range: `bytes=0-${Math.max(0, byteCount - 1)}`,
        }),
      );
      return Buffer.from(await assertByteArray(res.Body).transformToByteArray());
    } catch (err) {
      throw this.failure(FAILURES.readRange, { key, byteCount }, err);
    }
  }

  async readStream(key: string, bucket?: string): Promise<AsyncIterable<Uint8Array>> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: bucket ?? this.bucket, Key: key }),
      );
      return assertStream(res.Body);
    } catch (err) {
      throw this.failure(FAILURES.readStream, { key }, err);
    }
  }

  async read(key: string, bucket?: string): Promise<Buffer> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: bucket ?? this.bucket, Key: key }),
      );
      return Buffer.from(await assertByteArray(res.Body).transformToByteArray());
    } catch (err) {
      throw this.failure(FAILURES.read, { key }, err);
    }
  }
}
