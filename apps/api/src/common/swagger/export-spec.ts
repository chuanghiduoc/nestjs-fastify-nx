import 'reflect-metadata';
// MUST be first: sets placeholder env before CodegenAppModule loads, because its
// `ConfigModule.forRoot({ validate })` runs `validateConfig(process.env)` at module
// load. Inline statements can't do this — imports hoist above them. See codegen-env.ts.
import './codegen-env';

// The spec exporter only needs the DI graph for swagger introspection — no
// Redis traffic is required. BullMQ Queue / KeyvRedis / throttler still open
// sockets on import; when CI runs codegen without a Redis service they spam
// stderr with ECONNREFUSED loops. Silence ONLY those specific noises; any
// other stderr write (including the final `Failed to export spec:` message
// emitted by exportSpec's catch handler) still passes through.
const origStderrWrite = process.stderr.write.bind(process.stderr);
const REDIS_NOISE = /ECONNREFUSED|ioredis error|\[Better Auth\]/;
type StderrWriteArgs = Parameters<typeof process.stderr.write>;
process.stderr.write = ((...args: StderrWriteArgs): boolean => {
  const first = args[0];
  const text = typeof first === 'string' ? first : Buffer.isBuffer(first) ? first.toString() : '';
  if (REDIS_NOISE.test(text)) return true;
  return origStderrWrite(...args);
}) as typeof process.stderr.write;

// Swallow Redis connection failures (codegen has no Redis service); the spec
// only needs the DI graph. Any other fault still fails the build.
const isRedisConnectionError = (err: unknown): boolean => {
  const parts = [String((err as Error)?.message ?? err), (err as { code?: string })?.code ?? ''];
  const nested = (err as AggregateError)?.errors;
  if (Array.isArray(nested))
    parts.push(...nested.map((e) => `${e?.message ?? ''} ${e?.code ?? ''}`));
  return /ECONNREFUSED|ioredis/i.test(parts.join(' '));
};
process.on('uncaughtException', (err) => {
  if (isRedisConnectionError(err)) return;
  origStderrWrite(
    `Uncaught exception during spec export: ${(err as Error)?.stack ?? String(err)}\n`,
  );
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  if (isRedisConnectionError(reason)) return;
  origStderrWrite(`Unhandled rejection during spec export: ${String(reason)}\n`);
  process.exit(1);
});

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';

const noConnect = (): Promise<void> => Promise.resolve();
PrismaService.prototype.onModuleInit = noConnect;
PrismaService.prototype.onModuleDestroy = noConnect;

import { CodegenAppModule } from './codegen-app.module';
import { buildSwaggerDocument } from './swagger.config';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function exportSpec(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    CodegenAppModule,
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  await app.init();

  const document = await buildSwaggerDocument(app);
  const outputDir = path.join(process.cwd(), 'dist', 'swagger');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'openapi.json'), JSON.stringify(document, null, 2));

  process.stdout.write('OpenAPI spec exported to dist/swagger/openapi.json\n');
  await app.close();
}

exportSpec().catch((err) => {
  process.stderr.write(`Failed to export spec: ${(err as Error)?.stack ?? String(err)}\n`);
  process.exit(1);
});
