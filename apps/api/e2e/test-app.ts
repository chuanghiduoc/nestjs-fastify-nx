import { execSync } from 'child_process';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { toNodeHandler } from 'better-auth/node';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import {
  createTestContainers,
  DatabaseCleaner,
  type TestContainers,
} from '@nestjs-fastify-nx/testing';
import { AppModule } from '../src/app/app.module';

export interface TestAppContext {
  app: NestFastifyApplication;
  containers: TestContainers;
  cleaner: DatabaseCleaner;
}

// Bootstraps a NestFastifyApplication that mirrors main.ts: same global prefix
// (with /metrics excluded), the same single ValidationPipe, and the Better
// Auth handler mounted at /api/auth/*. We deliberately skip helmet/swagger/
// sentry/bull-board which are irrelevant for e2e, and we do NOT call
// useGlobalFilters / useGlobalInterceptors — AppModule already provides
// GlobalExceptionFilter via APP_FILTER and ResponseInterceptor via
// APP_INTERCEPTOR; registering them again wraps every response twice.
export async function createTestApp(): Promise<TestAppContext> {
  const containers = await createTestContainers();
  const dbUrl = containers.postgres.getConnectionUri();
  const redisHost = containers.redis.getHost();
  const redisPort = String(containers.redis.getFirstMappedPort());

  process.env['DATABASE_URL'] = dbUrl;
  process.env['REDIS_CACHE_HOST'] = redisHost;
  process.env['REDIS_CACHE_PORT'] = redisPort;
  process.env['REDIS_QUEUE_HOST'] = redisHost;
  process.env['REDIS_QUEUE_PORT'] = redisPort;
  process.env['BETTER_AUTH_SECRET'] = 'e2e-better-auth-secret-must-be-32-chars-long';

  execSync('pnpm prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Mirror main.ts: mount Better Auth before init so its routes win against the
  // global prefix. Without this, /api/auth/* hits no route and tests can't sign
  // up users.
  const fastify = app.getHttpAdapter().getInstance();
  const auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  const betterAuthHandler = toNodeHandler(auth.handler);
  fastify.all('/api/auth/*', async (req, reply) => {
    if (req.body !== undefined && (req.raw as unknown as { body?: unknown }).body === undefined) {
      (req.raw as unknown as { body: unknown }).body = req.body;
    }
    reply.hijack();
    await betterAuthHandler(req.raw, reply.raw);
  });

  await app.init();
  await fastify.ready();

  const cleaner = new DatabaseCleaner(app.get(PrismaService).db);
  return { app, containers, cleaner };
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
