import {
  Injectable,
  Logger,
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import {
  S3Client,
  PutObjectCommand,
  PutObjectTaggingCommand,
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

// forcePathStyle required for MinIO and S3-compatible services (R2, B2); harmless on AWS S3.
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
      maxAttempts: 3,
    });
  }

  // Auto-create bucket on startup — MinIO ships empty and first upload would 500 otherwise.
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
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        messageKey: I18N_KEYS.errors.storage.body_empty,
        args: { key },
        message: `Upload rejected — body is empty for key "${key}"`,
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
      this.logger.error({ err, key }, 'S3 upload failed');
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        messageKey: I18N_KEYS.errors.storage.upload_failed,
        message: 'Storage upload failed',
      });
    }

    const url = `${this.endpoint}/${bucket}/${key}`;

    return { key, bucket, url, size: body.length };
  }

  // POST policy pins Content-Type and size — prevents mime-type smuggling or oversized payloads.
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
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        messageKey: I18N_KEYS.errors.storage.presign_failed,
        message: 'Storage presign failed',
      });
    }
  }

  // Null = object missing (not yet uploaded); throws on transport errors.
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
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        messageKey: I18N_KEYS.errors.storage.head_failed,
        message: 'Storage head failed',
      });
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
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        messageKey: I18N_KEYS.errors.storage.signed_url_failed,
        message: 'Storage signed URL generation failed',
      });
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
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        messageKey: I18N_KEYS.errors.storage.delete_failed,
        message: 'Storage delete failed',
      });
    }
  }

  // Tag committed=true so the lifecycle rule expires untagged orphans after 24h.
  async commit(key: string, bucket?: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectTaggingCommand({
          Bucket: bucket ?? this.bucket,
          Key: key,
          Tagging: { TagSet: [{ Key: 'committed', Value: 'true' }] },
        }),
      );
    } catch (err) {
      this.logger.error({ err, key }, 'S3 commit tag failed');
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        messageKey: I18N_KEYS.errors.storage.commit_failed,
        message: 'Storage commit failed',
      });
    }
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
      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) {
        throw new Error('S3 GetObject returned no readable body');
      }
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      this.logger.error({ err, key, byteCount }, 'S3 readRange failed');
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        messageKey: I18N_KEYS.errors.storage.read_range_failed,
        message: 'Storage readRange failed',
      });
    }
  }
}
