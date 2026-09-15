import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareMultipartUploads } from './prepare-multipart-upload';

const PNG = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex');

function payload(boundary: string, contents: Buffer[]): Buffer {
  return Buffer.concat(
    contents
      .flatMap((body) => [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        body,
        Buffer.from('\r\n'),
      ])
      .concat(Buffer.from(`--${boundary}--\r\n`)),
  );
}

async function app() {
  const server = Fastify();
  await server.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  server.setErrorHandler((error: unknown, _request, reply) => {
    const status =
      error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function'
        ? (error.getStatus() as number)
        : 500;
    void reply.status(status).send({ status });
  });
  server.post('/', async (request, reply) => {
    const files = await prepareMultipartUploads(request, reply);
    expect(await prepareMultipartUploads(request, reply)).toBe(files);
    return Promise.all(
      files.map(async (file) => ({
        size: file.size,
        digest: file.digest,
        filepath: file.filepath,
        body: (await readFile(file.filepath)).toString('hex'),
      })),
    );
  });
  return server;
}

afterEach(() => vi.unstubAllEnvs());

describe('prepareMultipartUploads', () => {
  it('streams multiple files and cleans temporary files after response', async () => {
    const server = await app();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'multipart/form-data; boundary=sample' },
        payload: payload('sample', [PNG, PNG]),
      });
      expect(response.statusCode).toBe(200);
      const files =
        response.json<{ size: number; digest: string; filepath: string; body: string }[]>();
      expect(files).toHaveLength(2);
      expect(files[0]).toMatchObject({
        size: PNG.length,
        digest: createHash('sha256').update(PNG).digest('hex'),
        body: PNG.toString('hex'),
      });
      await vi.waitFor(async () => {
        for (const file of files) await expect(access(file.filepath)).rejects.toThrow();
      });
    } finally {
      await server.close();
    }
  });

  it('enforces aggregate bytes while streaming', async () => {
    vi.stubEnv('UPLOAD_MAX_TOTAL_BYTES', String(PNG.length + 1));
    const server = await app();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'multipart/form-data; boundary=sample' },
        payload: payload('sample', [PNG, PNG]),
      });
      expect(response.statusCode).toBe(413);
    } finally {
      await server.close();
    }
  });

  it('enforces the file count limit', async () => {
    vi.stubEnv('UPLOAD_MAX_FILES', '1');
    const server = await app();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'multipart/form-data; boundary=sample' },
        payload: payload('sample', [PNG, PNG]),
      });
      expect(response.statusCode).toBe(413);
    } finally {
      await server.close();
    }
  });

  it('rejects rather than hangs when the plugin itself caps the file count', async () => {
    vi.stubEnv('UPLOAD_MAX_FILES', '1');
    const server = Fastify();
    await server.register(multipart, {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, parts: 1 },
    });
    server.setErrorHandler((error: unknown, _request, reply) => {
      const status =
        error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function'
          ? (error.getStatus() as number)
          : 500;
      void reply.status(status).send({ status });
    });
    server.post(
      '/',
      async (request, reply) => (await prepareMultipartUploads(request, reply)).length,
    );
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'multipart/form-data; boundary=sample' },
        payload: payload('sample', [PNG, PNG]),
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await server.close();
    }
  });
});
