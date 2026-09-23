import { Test } from '@nestjs/testing';
import { VersioningType } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import Redis from 'ioredis';
import { closeQuietly } from '@nestjs-fastify-nx/infra-redis';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { STORAGE_PORT, type StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { DatabaseCleaner } from '@nestjs-fastify-nx/testing';
import { AppModule } from '../src/app/app.module';
import { registerIdempotency } from '../src/common/idempotency/register-idempotency';
import { ProblemDetailsValidationPipe } from '../src/common/pipes';
import { applyFastifyProblemDetailsHook } from '../src/common/filters/fastify-error-handler';
import { GLOBAL_PREFIX, GLOBAL_PREFIX_EXCLUDES } from '../src/common/http/global-prefix';
import {
  STRICT_AUTH_PATHS,
  registerAuthRateLimits,
} from '../src/common/auth-http/auth-rate-limits';
import { createBetterAuthRouteHandler } from '../src/common/auth-http/better-auth-route-handler';

// In-process stub — e2e covers controller logic, not the S3 wire format.
// Real S3 paths are unit-tested in s3-storage.adapter.spec.ts.
const e2eObjects = new Map<
  string,
  { body: Buffer; contentType: string; bucket: string; etag: string }
>();

export function seedE2eStorageObject(key: string, body: Buffer, contentType: string): void {
  e2eObjects.set(key, { body, contentType, bucket: 'uploads', etag: '"e2e-etag"' });
}

const e2eStorageStub: StoragePort = {
  uploadStream: async (key, stream, options) => {
    const chunks: Buffer[] = [];
    for await (const value of stream) {
      options.signal?.throwIfAborted();
      chunks.push(Buffer.from(value as Uint8Array));
    }
    const body = Buffer.concat(chunks);
    seedE2eStorageObject(key, body, options.contentType ?? 'application/octet-stream');
    return { key, bucket: options.bucket ?? 'uploads', size: body.length };
  },
  presignUpload: async (key, options) => ({
    url: 'http://e2e-stub/uploads',
    fields: { key, 'Content-Type': options.contentType },
    key,
    bucket: options.bucket ?? 'uploads',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    maxBytes: options.maxBytes,
  }),
  // head() returns null for any key — confirm tests rely on this for the 404 path.
  head: async (key) => {
    const object = e2eObjects.get(key);
    return object
      ? {
          contentType: object.contentType,
          size: object.body.length,
          bucket: object.bucket,
          etag: object.etag,
        }
      : null;
  },
  getSignedUrl: async (key) => `http://e2e-stub/signed/${key}`,
  delete: async (key) => {
    e2eObjects.delete(key);
  },
  finalize: async (sourceKey, finalKey) => {
    const source = e2eObjects.get(sourceKey);
    if (!source) throw new Error('source object missing');
    e2eObjects.set(finalKey, source);
    e2eObjects.delete(sourceKey);
  },
  readRange: async (key, byteCount) =>
    e2eObjects.get(key)?.body.subarray(0, byteCount) ?? Buffer.alloc(0),
  readStream: async (key) => {
    const body = e2eObjects.get(key)?.body ?? Buffer.alloc(0);
    return {
      async *[Symbol.asyncIterator]() {
        yield body;
      },
      close() {
        /* In-memory data has no external resource. */
      },
    };
  },
};

// Allowed cross-origin used to assert CORS headers survive the Better Auth hijack path.
export const E2E_CORS_ORIGIN = 'http://localhost:5173';

export interface TestAppContext {
  app: NestFastifyApplication;
  cleaner: DatabaseCleaner;
  prisma: PrismaService;
}

// See docs/adr/0006-shared-e2e-application-instance.md for why the app is shared across specs
// and how it is torn down.
let sharedApp: Promise<TestAppContext> | undefined;
let closingSharedApp: Promise<void> | undefined;
let throttlerRedis: Redis | undefined;
let authRateLimitRedis: Redis | undefined;

function closeSharedApp(): Promise<void> {
  if (!sharedApp) return Promise.resolve();
  closingSharedApp ??= sharedApp
    .then((ctx) => ctx.app.close())
    .catch(() => undefined)
    .finally(() => {
      sharedApp = undefined;
    });
  return closingSharedApp;
}

process.once('beforeExit', () => {
  void Promise.allSettled([closeSharedApp(), closeThrottlerRedis()]);
});

// Mirrors main.ts (prefix, ProblemDetailsValidationPipe, Better Auth mount)
// minus helmet/swagger/sentry/bull-board. Do NOT call useGlobalFilters here —
// AppModule's APP_FILTER would wrap responses twice. Postgres + Redis are
// spun up once by global-setup.ts and the connection info is read from the
// E2E_DATABASE_URL / E2E_REDIS_HOST / E2E_REDIS_PORT env vars below.
export function createTestApp(): Promise<TestAppContext> {
  sharedApp ??= bootstrapTestApp();
  return sharedApp;
}

async function bootstrapTestApp(): Promise<TestAppContext> {
  const dbUrl = process.env['E2E_DATABASE_URL'];
  const redisHost = process.env['E2E_REDIS_HOST'];
  const redisPort = process.env['E2E_REDIS_PORT'];

  if (!dbUrl || !redisHost || !redisPort) {
    throw new Error(
      'E2E container env vars not set. Ensure global-setup.ts ran via Vitest globalSetup.',
    );
  }

  process.env['DATABASE_URL'] = dbUrl;
  process.env['REDIS_CACHE_HOST'] = redisHost;
  process.env['REDIS_CACHE_PORT'] = redisPort;
  process.env['REDIS_QUEUE_HOST'] = redisHost;
  process.env['REDIS_QUEUE_PORT'] = redisPort;
  delete process.env['REDIS_CACHE_PASSWORD'];
  delete process.env['REDIS_QUEUE_PASSWORD'];
  process.env['BETTER_AUTH_SECRET'] = 'e2e-better-auth-secret-must-be-32-chars-long';
  // Enable the Google provider so the social sign-in test can build an authorize
  // URL. Fake creds are fine — sign-in/social only mints the redirect URL locally.
  process.env['GOOGLE_CLIENT_ID'] = 'e2e-google-client-id';
  process.env['GOOGLE_CLIENT_SECRET'] = 'e2e-google-client-secret';

  // Low strict cap so the 429 test fires after 3 requests; loose cap stays
  // high enough that session ops between tests don't trip it.
  process.env['AUTH_RATE_LIMIT_MAX'] = '3';
  process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = '60000';
  process.env['AUTH_IP_RATE_LIMIT_MAX'] = '10000';
  process.env['AUTH_SESSION_RATE_LIMIT_MAX'] = '200';
  process.env['AUTH_SESSION_RATE_LIMIT_WINDOW_MS'] = '60000';
  // 64 KB body limit — small enough for the >bodyLimit 413 test to fire cheaply.
  process.env['HTTP_BODY_LIMIT_BYTES'] = String(64 * 1024);
  process.env['MALWARE_SCANNER_ENABLED'] = 'false';
  process.env['UPLOAD_MAX_FILE_BYTES'] = String(5 * 1024 * 1024); // 5 MB for test

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Override S3 adapter — no minio container in e2e; controller-level tests
    // only need head()=null / presign-roundtrip behaviour.
    .overrideProvider(STORAGE_PORT)
    .useValue(e2eStorageStub)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: 64 * 1024 }),
  );
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: [...GLOBAL_PREFIX_EXCLUDES] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Mirror main.ts CORS so the hijacked-auth-response header-preservation invariant is covered e2e.
  app.enableCors({
    origin: [E2E_CORS_ORIGIN],
    credentials: true,
    exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id', 'X-Correlation-Id'],
  });
  app.useGlobalPipes(new ProblemDetailsValidationPipe());

  // Mirror main.ts: mount Better Auth before init so its routes win against the
  // global prefix. Without this, /api/auth/* hits no route and tests can't sign
  // up users.
  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(fastifyCookie);

  // Mirror main.ts idempotency wiring against the E2E Redis (db=5) so Idempotency-Key replay is
  // exercised end-to-end. onClose quits the client when app.close() runs in afterAll.
  const idempotencyRedis = new Redis({ host: redisHost, port: Number(redisPort), db: 5 });
  fastify.addHook('onClose', async () => {
    await idempotencyRedis.quit().catch(() => idempotencyRedis.disconnect());
  });
  app.useGlobalInterceptors(
    registerIdempotency(fastify, {
      redis: idempotencyRedis,
      ttlSeconds: 86_400,
      lockTtlSeconds: 60,
    }),
  );

  applyFastifyProblemDetailsHook(fastify);

  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: Number(process.env['UPLOAD_MAX_FILE_BYTES']),
      files: 10,
      fields: 0,
      parts: 10,
    },
  });

  const rateLimitRedis = new Redis({ host: redisHost, port: Number(redisPort), db: 4 });
  authRateLimitRedis = rateLimitRedis;
  await rateLimitRedis.flushdb();
  fastify.addHook('onClose', () => {
    authRateLimitRedis = undefined;
    return closeQuietly(rateLimitRedis);
  });
  const logger = app.get(Logger);
  const { strictAuthRouteConfig, looseAuthRouteConfig } = await registerAuthRateLimits(
    fastify,
    rateLimitRedis,
    {
      authRateLimitMax: Number(process.env['AUTH_RATE_LIMIT_MAX']),
      authIpRateLimitMax: Number(process.env['AUTH_IP_RATE_LIMIT_MAX']),
      authRateLimitWindowMs: Number(process.env['AUTH_RATE_LIMIT_WINDOW_MS']),
      authRateLimitFailOpen: false,
      authSessionRateLimitMax: Number(process.env['AUTH_SESSION_RATE_LIMIT_MAX']),
      authSessionRateLimitWindowMs: Number(process.env['AUTH_SESSION_RATE_LIMIT_WINDOW_MS']),
    },
    logger,
  );

  const auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  const authRouteHandler = createBetterAuthRouteHandler(auth, {
    timeoutMs: Number(process.env['HTTP_REQUEST_TIMEOUT_MS'] ?? 30_000),
    logger,
  });

  for (const path of STRICT_AUTH_PATHS) {
    fastify.all(path, strictAuthRouteConfig, authRouteHandler);
  }
  fastify.all('/api/auth/*', looseAuthRouteConfig, authRouteHandler);

  await app.init();
  await fastify.ready();

  const prisma = app.get(PrismaService);
  const cleaner = new DatabaseCleaner(prisma.db);
  return { app, cleaner, prisma };
}

// Joins multiple Set-Cookie values into one Cookie request header. Better Auth
// returns several cookies (session_token + dont_remember + …); supertest's
// .set('Cookie', value) replaces, so the helper concatenates name=value pairs.
// The NestJS throttler counts per IP in Redis db 1, so every spec in a run shares one budget and a
// spec that uploads a lot silently 429s whichever spec happens to run next. Clearing that db keeps
// specs independent of execution order without weakening the limits the app actually ships.
export async function resetRateLimitBudget(): Promise<void> {
  throttlerRedis ??= new Redis({
    host: process.env['E2E_REDIS_HOST'],
    port: Number(process.env['E2E_REDIS_PORT']),
    db: 1,
  });
  await Promise.all([throttlerRedis.flushdb(), authRateLimitRedis?.flushdb()]);
}

async function closeThrottlerRedis(): Promise<void> {
  if (!throttlerRedis) return;
  const redis = throttlerRedis;
  throttlerRedis = undefined;
  await redis.quit().catch(() => redis.disconnect());
}

export function cookieHeaderFromSetCookies(setCookieHeader: string | string[] | undefined): string {
  if (!setCookieHeader) return '';
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return headers
    .map((line) => line.split(';')[0])
    .filter(Boolean)
    .join('; ');
}
