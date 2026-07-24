import { Test } from '@nestjs/testing';
import { HttpStatus, VersioningType } from '@nestjs/common';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { toNodeHandler } from 'better-auth/node';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import Redis from 'ioredis';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { STORAGE_PORT, type StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { DatabaseCleaner } from '@nestjs-fastify-nx/testing';
import { AppModule } from '../src/app/app.module';
import { registerIdempotency } from '../src/common/idempotency/register-idempotency';
import { ProblemDetailsValidationPipe } from '../src/common/pipes';
import { applyFastifyProblemDetailsHook } from '../src/common/filters/fastify-error-handler';
import { buildProblemDetails } from '../src/common/filters/problem-details.helper';

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
  upload: async (key, body, options) => ({
    key,
    bucket: options?.bucket ?? 'uploads',
    url: `http://e2e-stub/${key}`,
    size: body.length,
  }),
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
};

// Allowed cross-origin used to assert CORS headers survive the Better Auth hijack path.
export const E2E_CORS_ORIGIN = 'http://localhost:5173';

export interface TestAppContext {
  app: NestFastifyApplication;
  cleaner: DatabaseCleaner;
  prisma: PrismaService;
}

// Mirrors main.ts (prefix, ProblemDetailsValidationPipe, Better Auth mount)
// minus helmet/swagger/sentry/bull-board. Do NOT call useGlobalFilters here —
// AppModule's APP_FILTER would wrap responses twice. Postgres + Redis are
// spun up once by global-setup.ts and the connection info is read from the
// E2E_DATABASE_URL / E2E_REDIS_HOST / E2E_REDIS_PORT env vars below.
export async function createTestApp(): Promise<TestAppContext> {
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
  process.env['BETTER_AUTH_SECRET'] = 'e2e-better-auth-secret-must-be-32-chars-long';
  // Enable the Google provider so the social sign-in test can build an authorize
  // URL. Fake creds are fine — sign-in/social only mints the redirect URL locally.
  process.env['GOOGLE_CLIENT_ID'] = 'e2e-google-client-id';
  process.env['GOOGLE_CLIENT_SECRET'] = 'e2e-google-client-secret';

  // Low strict cap so the 429 test fires after 3 requests; loose cap stays
  // high enough that session ops between tests don't trip it.
  process.env['AUTH_RATE_LIMIT_MAX'] = '3';
  process.env['AUTH_RATE_LIMIT_WINDOW_MS'] = '60000';
  process.env['AUTH_SESSION_RATE_LIMIT_MAX'] = '200';
  process.env['AUTH_SESSION_RATE_LIMIT_WINDOW_MS'] = '60000';
  // 64 KB body limit — small enough for the >bodyLimit 413 test to fire cheaply.
  process.env['HTTP_BODY_LIMIT_BYTES'] = String(64 * 1024);
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
  app.setGlobalPrefix('api', { exclude: ['metrics'] });
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

  // Mirror main.ts idempotency wiring against the E2E Redis (db=5) so Idempotency-Key replay is
  // exercised end-to-end. onClose quits the client when app.close() runs in afterAll.
  const idempotencyRedis = new Redis({ host: redisHost, port: Number(redisPort), db: 5 });
  fastify.addHook('onClose', async () => {
    await idempotencyRedis.quit().catch(() => idempotencyRedis.disconnect());
  });
  registerIdempotency(fastify, {
    redis: idempotencyRedis,
    ttlSeconds: 86_400,
    lockTtlSeconds: 60,
  });

  // Register rate-limit + multipart mirroring main.ts so 429 and 413 edge cases
  // are exercised in e2e. Uses in-memory store (no Redis needed in tests).
  await fastify.register(fastifyRateLimit, {
    global: false,
    hook: 'preHandler',
    max: Number(process.env['AUTH_RATE_LIMIT_MAX']),
    timeWindow: Number(process.env['AUTH_RATE_LIMIT_WINDOW_MS']),
    keyGenerator: (req) => {
      const body = req.body as Record<string, unknown> | undefined;
      const email = body && typeof body['email'] === 'string' ? body['email'].toLowerCase() : '';
      return `${req.ip}:${email}`;
    },
    // Same builder main.ts uses — a hand-rolled body here would let e2e pass against a shape
    // production does not emit.
    errorResponseBuilder: (req, context) => ({
      ...buildProblemDetails({
        status: HttpStatus.TOO_MANY_REQUESTS,
        title: 'Too Many Requests',
        detail: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
        code: ERROR_CODES.RATE_LIMITED,
        instance: req.url,
      }),
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  applyFastifyProblemDetailsHook(fastify);

  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: Number(process.env['UPLOAD_MAX_FILE_BYTES']),
      files: 1,
      fields: 20,
      parts: 50,
    },
  });

  const auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  const betterAuthHandler = toNodeHandler(auth.handler);

  const strictMax = Number(process.env['AUTH_RATE_LIMIT_MAX']);
  const strictWindow = Number(process.env['AUTH_RATE_LIMIT_WINDOW_MS']);
  const looseMax = Number(process.env['AUTH_SESSION_RATE_LIMIT_MAX']);
  const looseWindow = Number(process.env['AUTH_SESSION_RATE_LIMIT_WINDOW_MS']);
  const strictConfig: RouteShorthandOptions = {
    config: { rateLimit: { max: strictMax, timeWindow: strictWindow } },
  };
  const looseConfig: RouteShorthandOptions = {
    config: {
      rateLimit: { max: looseMax, timeWindow: looseWindow, keyGenerator: (req) => req.ip },
    },
  };
  const STRICT_AUTH_PATHS = [
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/request-password-reset',
    '/api/auth/reset-password',
  ] as const;

  const authRouteHandler = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.body !== undefined && (req.raw as unknown as { body?: unknown }).body === undefined) {
      (req.raw as unknown as { body: unknown }).body = req.body;
    }
    // Mirror main.ts: flush headers buffered by @fastify/cors's onRequest hook onto the raw response
    // before hijack, otherwise Better Auth's node handler drops them from the reply.
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.hijack();
    await betterAuthHandler(req.raw, reply.raw);
  };

  for (const path of STRICT_AUTH_PATHS) {
    fastify.all(path, strictConfig, authRouteHandler);
  }
  fastify.all('/api/auth/*', looseConfig, authRouteHandler);

  await app.init();
  await fastify.ready();

  const prisma = app.get(PrismaService);
  const cleaner = new DatabaseCleaner(prisma.db);
  return { app, cleaner, prisma };
}

// Joins multiple Set-Cookie values into one Cookie request header. Better Auth
// returns several cookies (session_token + dont_remember + …); supertest's
// .set('Cookie', value) replaces, so the helper concatenates name=value pairs.
export function cookieHeaderFromSetCookies(setCookieHeader: string | string[] | undefined): string {
  if (!setCookieHeader) return '';
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return headers
    .map((line) => line.split(';')[0])
    .filter(Boolean)
    .join('; ');
}
