import 'reflect-metadata';

function setIfMissing(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

setIfMissing('NODE_ENV', 'development');
setIfMissing('DATABASE_URL', 'postgresql://codegen:codegen@localhost:5432/codegen');
setIfMissing('BETTER_AUTH_SECRET', 'codegen-placeholder-secret-min-32-characters-ok');
// Better Auth logs a warning at module init if BETTER_AUTH_URL is unset, even
// though the spec exporter never serves a real request. Sentinel keeps it quiet.
setIfMissing('BETTER_AUTH_URL', 'http://codegen.invalid');
setIfMissing('CORS_ORIGINS', 'http://localhost:3000');
setIfMissing('STORAGE_ACCESS_KEY', 'codegen');
setIfMissing('STORAGE_SECRET_KEY', 'codegen');
setIfMissing('BULL_BOARD_PASSWORD', 'codegen');
setIfMissing('MAIL_HOST', 'codegen.mail.invalid');
setIfMissing('MAIL_DEFAULT_EMAIL', 'codegen@codegen.invalid');
setIfMissing('ENABLE_METRICS', 'false');

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

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  await app.init();

  const document = buildSwaggerDocument(app);
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
