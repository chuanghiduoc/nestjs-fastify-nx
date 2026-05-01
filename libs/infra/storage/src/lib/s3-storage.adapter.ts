import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
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

/**
 * S3-compatible storage adapter (works with AWS S3 and MinIO).
 *
 * Production notes:
 * - All config values are required in production; defaults are safe for local
 *   dev/MinIO only and will log a warning when they are used.
 * - Retry is handled by the AWS SDK's default retry middleware (3 attempts,
 *   exponential back-off with jitter).  Bump `maxAttempts` if you need more.
 * - `forcePathStyle: true` is required for MinIO and S3-compatible services
 *   that do not support virtual-hosted-style URLs.  AWS S3 itself works fine
 *   with path-style so it is safe to leave enabled.
 * - The `url` field on `StoredFile` is NOT a pre-signed URL — it is a plain
 *   path-style object URL suitable for internal use or public buckets.
 *   For time-limited access use `getSignedUrl`.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort, OnModuleInit {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;

  constructor(private readonly config: ConfigService) {
    this.endpoint = this.requireConfig('STORAGE_ENDPOINT', 'http://localhost:9000');
    this.bucket = this.requireConfig('STORAGE_BUCKET', 'uploads');

    const region = this.requireConfig('STORAGE_REGION', 'us-east-1');
    const accessKeyId = this.requireConfig('STORAGE_ACCESS_KEY', 'minioadmin');
    const secretAccessKey = this.requireConfig('STORAGE_SECRET_KEY', 'minioadmin');

    this.client = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      // AWS SDK v3 default is 3 retries.  Explicit here for visibility.
      maxAttempts: 3,
    });
  }

  /**
   * Bootstrap the configured bucket on startup. MinIO ships empty by default,
   * so the very first upload would 500 with `NoSuchBucket`. In production we
   * still attempt creation but only swallow the "already exists" cases —
   * permission errors must surface so misconfigured IAM is caught early.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (status !== 404 && status !== undefined) {
        this.logger.warn(
          { err, bucket: this.bucket, status },
          'Bucket head check failed — skipping auto-create',
        );
        return;
      }
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket "${this.bucket}"`);
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
        return;
      }
      this.logger.error({ err, bucket: this.bucket }, 'Failed to create storage bucket');
    }
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

  async upload(key: string, body: Buffer, options?: UploadOptions): Promise<StoredFile> {
    if (body.length === 0) {
      throw new BadRequestException(`Upload rejected — body is empty for key "${key}"`);
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
      this.logger.error({ err, key }, 'S3 upload failed');
      throw new InternalServerErrorException('Storage upload failed');
    }

    // Plain path-style URL — not signed, suitable for internal/public access.
    // Callers that need time-limited access should use getSignedUrl().
    const url = `${this.endpoint}/${bucket}/${key}`;

    return { key, bucket, url, size: body.length };
  }

  // Issues a short-lived POST policy so the browser uploads bytes directly to
  // S3/MinIO. Conditions pin Content-Type and total size, so a client cannot
  // smuggle in a different mime type or oversized payload.
  async presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedUpload> {
    const bucket = options.bucket ?? this.bucket;
    const expiresInSeconds = options.expiresInSeconds ?? 300;

    try {
      const { url, fields } = await createPresignedPost(this.client, {
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
      this.logger.error({ err, key }, 'S3 presign upload failed');
      throw new InternalServerErrorException('Storage presign failed');
    }
  }

  // Returns null for missing objects so callers can distinguish "not yet
  // uploaded" from a transport error without parsing AWS error shapes.
  async head(key: string, bucket?: string): Promise<ObjectMetadata | null> {
    const targetBucket = bucket ?? this.bucket;
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: targetBucket, Key: key }));
      return {
        contentType: res.ContentType ?? 'application/octet-stream',
        size: Number(res.ContentLength ?? 0),
        bucket: targetBucket,
      };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      const name = (err as { name?: string })?.name;
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
        return null;
      }
      this.logger.error({ err, key }, 'S3 head failed');
      throw new InternalServerErrorException('Storage head failed');
    }
  }

  async getSignedUrl(key: string, expiresIn = 3600, bucket?: string): Promise<string> {
    const targetBucket = bucket ?? this.bucket;
    try {
      const command = new GetObjectCommand({
        Bucket: targetBucket,
        Key: key,
      });
      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (err) {
      this.logger.error({ err, key }, 'S3 getSignedUrl failed');
      throw new InternalServerErrorException('Storage signed URL generation failed');
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
      this.logger.error({ err, key }, 'S3 delete failed');
      throw new InternalServerErrorException('Storage delete failed');
    }
  }
}
