import '@fastify/multipart';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import {
  assertMagicBytesMatch,
  assertMimeAllowed,
  assertSizeWithinLimit,
} from '../../domain/entities/stored-file.entity';
import { readUploadLimits, UPLOAD_MAGIC_BYTE_COUNT } from '../../application/upload-limits';

export interface PreparedMultipartUpload {
  filepath: string;
  contentType: string;
  size: number;
  digest: string;
  signal: AbortSignal;
}

const UNCAPPED_PART_LIMITS = (fileSize: number) => ({
  fileSize,
  files: Number.MAX_SAFE_INTEGER,
  fields: Number.MAX_SAFE_INTEGER,
  parts: Number.MAX_SAFE_INTEGER,
});

const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 900_000;
const prepared = new WeakMap<FastifyRequest, Promise<PreparedMultipartUpload[]>>();
let activeRequests = 0;

export function prepareMultipartUploads(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PreparedMultipartUpload[]> {
  const existing = prepared.get(request);
  if (existing) return existing;
  const paths: string[] = [];
  const result = prepare(request, reply, paths);
  prepared.set(request, result);
  let cleanupStarted = false;
  const cleanup = (): void => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    void result
      .catch(() => undefined)
      .then(async () => {
        for (const path of paths) {
          await unlink(path).catch((error: unknown) =>
            request.log.error({ err: error }, 'Upload temporary file cleanup failed'),
          );
        }
      });
  };
  reply.raw.once('finish', cleanup);
  reply.raw.once('close', cleanup);
  return result;
}

export async function prepareMultipartUpload(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PreparedMultipartUpload> {
  const files = await prepareMultipartUploads(request, reply);
  if (files.length !== 1) throw new BadRequestException('Exactly one file is required.');
  return files[0];
}

function acquireRequest(request: FastifyRequest, reply: FastifyReply): AbortSignal {
  const maximum = positiveIntEnv('UPLOAD_MAX_CONCURRENT_REQUESTS', 4);
  if (activeRequests >= maximum)
    throw new HttpException('Upload capacity reached. Retry shortly.', 429);
  activeRequests += 1;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, positiveIntEnv('UPLOAD_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
  timer.unref();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    activeRequests -= 1;
    clearTimeout(timer);
    controller.abort();
    request.raw.off('aborted', abort);
  };
  request.raw.once('aborted', abort);
  reply.raw.once('finish', release);
  reply.raw.once('close', release);
  return controller.signal;
}

async function prepare(
  request: FastifyRequest,
  reply: FastifyReply,
  paths: string[],
): Promise<PreparedMultipartUpload[]> {
  if (!request.isMultipart()) throw new BadRequestException('Expected multipart/form-data.');
  const signal = acquireRequest(request, reply);
  const maximum = readUploadLimits().maxFileBytes;
  const maxFiles = positiveIntEnv('UPLOAD_MAX_FILES', 10);
  const budget = { remaining: positiveIntEnv('UPLOAD_MAX_TOTAL_BYTES', DEFAULT_MAX_TOTAL_BYTES) };
  const files: PreparedMultipartUpload[] = [];
  const abort = (): void => {
    request.raw.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const part of request.parts({ limits: UNCAPPED_PART_LIMITS(maximum) })) {
      signal.throwIfAborted();
      if (part.type !== 'file' || part.fieldname !== 'file')
        throw new BadRequestException('Only file fields named file are accepted.');
      if (files.length >= maxFiles)
        throw new PayloadTooLargeException('Upload exceeds the file count limit.');
      assertMimeAllowed(part.mimetype);
      const filepath = join(tmpdir(), `upload-${randomUUID()}`);
      paths.push(filepath);
      files.push(await saveFile(part, { filepath, maximum, budget, signal }));
    }
    if (files.length === 0) throw new BadRequestException('At least one file is required.');
    return files;
  } catch (error) {
    if (
      error instanceof Error &&
      'statusCode' in error &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code.startsWith('FST_') &&
      typeof error.statusCode === 'number'
    ) {
      throw new HttpException('Invalid multipart upload.', error.statusCode, { cause: error });
    }
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function saveFile(
  part: MultipartFile,
  options: {
    filepath: string;
    maximum: number;
    budget: { remaining: number };
    signal: AbortSignal;
  },
): Promise<PreparedMultipartUpload> {
  const hash = createHash('sha256');
  const signature = Buffer.alloc(UPLOAD_MAGIC_BYTE_COUNT);
  let size = 0;
  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (size < UPLOAD_MAGIC_BYTE_COUNT)
        chunk.copy(signature, size, 0, UPLOAD_MAGIC_BYTE_COUNT - size);
      size += chunk.length;
      options.budget.remaining -= chunk.length;
      if (options.budget.remaining < 0 || size > options.maximum) {
        callback(new PayloadTooLargeException('Upload exceeds the byte limit.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    part.file,
    inspect,
    createWriteStream(options.filepath, { flags: 'wx', mode: 0o600 }),
    { signal: options.signal },
  );
  if (part.file.truncated) throw new PayloadTooLargeException('File exceeds the byte limit.');
  assertSizeWithinLimit(size, options.maximum);
  assertMagicBytesMatch(
    signature.subarray(0, Math.min(size, UPLOAD_MAGIC_BYTE_COUNT)),
    part.mimetype,
    'file',
  );
  return {
    filepath: options.filepath,
    contentType: part.mimetype,
    size,
    digest: hash.digest('hex'),
    signal: options.signal,
  };
}
