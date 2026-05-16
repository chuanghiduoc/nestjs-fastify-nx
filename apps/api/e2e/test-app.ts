import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { toNodeHandler } from 'better-auth/node';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { DatabaseCleaner } from '@nestjs-fastify-nx/testing';
import { AppModule } from '../src/app/app.module';
import { applyFastifyErrorHandler } from '../src/common/filters/fastify-error-handler';
import { ProblemDetailsValidationPipe } from '../src/common/pipes';

export interface TestAppContext {
  app: NestFastifyApplication;
  cleaner: DatabaseCleaner;
}

// Bootstraps a NestFastifyApplication that mirrors main.ts: same global prefix
// (with /metrics excluded), the same ProblemDetailsValidationPipe, and the
// Better Auth handler mounted at /api/auth/*. We deliberately skip helmet/
// swagger/sentry/bull-board which are irrelevant for e2e, and we do NOT call
// useGlobalFilters — AppModule already provides GlobalExceptionFilter via
// APP_FILTER; registering it twice would wrap every response twice.
//
// Containers are started once by global-setup.ts (Vitest globalSetup) and
// their connection details written to E2E_DATABASE_URL / E2E_REDIS_HOST /
// E2E_REDIS_PORT. Each spec calls cleaner.truncateAll() in beforeEach.
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
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: 64 * 1024 }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
  app.useGlobalPipes(new ProblemDetailsValidationPipe());

  // Mirror main.ts: mount Better Auth before init so its routes win against the
  // global prefix. Without this, /api/auth/* hits no route and tests can't sign
  // up users.
  const fastify = app.getHttpAdapter().getInstance();

  // Wire RFC 9457 problem+json error handler — mirrors main.ts so 4xx/5xx from
  // the body parser (FST_ERR_CTP_BODY_TOO_LARGE → 413) are correctly shaped.
  applyFastifyErrorHandler(fastify);

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
    errorResponseBuilder: (_req, context) => ({
      type: 'https://tools.ietf.org/html/rfc6585#section-4',
      title: 'Too Many Requests',
      status: 429,
      detail: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  fastify.addHook('onSend', (_req, reply, _payload, done) => {
    if (
      reply.statusCode === 429 &&
      !reply.getHeader('content-type')?.toString().includes('problem+json')
    ) {
      reply.header('content-type', 'application/problem+json');
    }
    done();
  });

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
    '/api/auth/forget-password',
    '/api/auth/reset-password',
  ] as const;

  const authRouteHandler = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.body !== undefined && (req.raw as unknown as { body?: unknown }).body === undefined) {
      (req.raw as unknown as { body: unknown }).body = req.body;
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

  const cleaner = new DatabaseCleaner(app.get(PrismaService).db);
  return { app, cleaner };
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
