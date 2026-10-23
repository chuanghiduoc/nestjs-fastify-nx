import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catch, VersioningType, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyReply } from 'fastify';
import { DomainException } from '@nestjs-fastify-nx/core';
import { STORAGE_PORT, type StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { ProblemDetailsValidationPipe } from '../pipes';
import { LocalStorageModule } from './local-storage.module';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
const BOUNDARY = 'local-storage-boundary';
const KIND_STATUS: Record<string, number> = {
  malformed: 400,
  validation: 422,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
};

@Catch(DomainException)
class DomainStatusFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost): void {
    void host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(KIND_STATUS[exception.kind])
      .send({ code: exception.code });
  }
}

function multipartBody(fields: Record<string, string>, file?: Buffer): Buffer {
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) =>
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  if (file) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      file,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

describe('LocalStorageController', () => {
  let app: NestFastifyApplication;
  let storage: StoragePort;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'local-storage-http-'));
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              STORAGE_DRIVER: 'local',
              STORAGE_LOCAL_ROOT: root,
              STORAGE_PUBLIC_ENDPOINT: 'http://localhost',
              STORAGE_LOCAL_SIGNING_SECRET: 'k'.repeat(40),
            }),
          ],
        }),
        LocalStorageModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyMultipart, { limits: { fileSize: 1024 * 1024 } });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ProblemDetailsValidationPipe());
    app.useGlobalFilters(new DomainStatusFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    storage = app.get(STORAGE_PORT);
  });

  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  async function post(fields: Record<string, string>, file?: Buffer) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/storage/local/uploads',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipartBody(fields, file),
    });
  }

  it('accepts a presigned upload and serves it back through a signed download URL', async () => {
    const presigned = await storage.presignUpload('uploads/u1/a.png', {
      contentType: 'image/png',
      maxBytes: 1024,
    });

    const upload = await post(presigned.fields, PNG);
    expect(upload.statusCode).toBe(204);

    const url = new URL(await storage.getSignedUrl('uploads/u1/a.png', 60));
    const download = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['content-disposition']).toBe('attachment');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.rawPayload).toEqual(PNG);
  });

  it('rejects a forged upload policy with 403', async () => {
    const presigned = await storage.presignUpload('uploads/u1/b.png', {
      contentType: 'image/png',
      maxBytes: 1024,
    });

    const response = await post({ ...presigned.fields, 'max-bytes': '999999' }, PNG);

    expect(response.statusCode).toBe(403);
    expect(await storage.head('uploads/u1/b.png')).toBeNull();
  });

  it('rejects a form without a file part', async () => {
    const response = await post({ key: 'uploads/u1/c.png' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-multipart upload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/storage/local/uploads',
      payload: { key: 'x' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('validates the download query before touching storage', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/storage/local/objects?bucket=uploads&key=a.png&expires=soon&signature=x',
    });

    expect(response.statusCode).toBe(422);
  });

  it('answers 404 for a validly signed URL whose object is gone', async () => {
    const url = new URL(await storage.getSignedUrl('uploads/u1/never.png', 60));

    const response = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });

    expect(response.statusCode).toBe(404);
  });
});
