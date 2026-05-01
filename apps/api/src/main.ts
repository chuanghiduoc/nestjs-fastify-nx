import './tracing';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { fastifyHelmet } from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { toNodeHandler } from 'better-auth/node';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { AppModule } from './app/app.module';
import { ProblemDetailsValidationPipe } from './common/pipes';
import { setupSwagger } from './common/swagger/swagger.config';
import { createBullBoardPlugin } from './common/bull-board/create-bull-board-plugin';
import type { EnvConfig } from './config/env.validation';

const sentryDsn = process.env['SENTRY_DSN'];
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? 'development',
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0.1),
    integrations: [nodeProfilingIntegration()],
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: 1 }),
    { bufferLogs: true },
  );

  const config = app.get<ConfigService<EnvConfig, true>>(ConfigService);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });

  const fastify = app.getHttpAdapter().getInstance();
  // CSP is locked down in production. In dev we disable it so GraphiQL,
  // Bull Board, Scalar, and other tooling can pull assets from CDNs
  // (unpkg, jsdelivr, scalar.com) without requiring per-host allow-lists.
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            fontSrc: ["'self'", 'https:', 'data:'],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            objectSrc: ["'none'"],
            scriptSrc: [
              "'self'",
              "'unsafe-inline'",
              "'unsafe-eval'",
              'https://cdn.jsdelivr.net',
              'https://*.scalar.com',
            ],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
            connectSrc: [
              "'self'",
              'https://cdn.jsdelivr.net',
              'https://*.scalar.com',
              'https://api.scalar.com',
            ],
            upgradeInsecureRequests: [],
            workerSrc: ["'self'", 'blob:'],
          },
        }
      : false,
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await fastify.register(fastifyMultipart);

  // Mount Better Auth handler at /api/auth/* before NestJS routes resolve.
  // Must run before global validation pipes — Better Auth handles its own body parsing.
  const auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  const betterAuthHandler = toNodeHandler(auth.handler);
  fastify.all('/api/auth/*', async (req, reply) => {
    // Fastify consumes the request stream into `req.body`. Better Auth's
    // toNodeHandler reads from req.raw — propagate the parsed body so its
    // fallback path can re-serialize it into a Web Request.
    if (req.body !== undefined && (req.raw as unknown as { body?: unknown }).body === undefined) {
      (req.raw as unknown as { body: unknown }).body = req.body;
    }
    reply.hijack();
    await betterAuthHandler(req.raw, reply.raw);
  });

  if (config.get('BULL_BOARD_ENABLED', { infer: true })) {
    // Mounted as a Fastify plugin, so Nest's `setGlobalPrefix('api/v1')` does
    // NOT apply — the basePath here is the absolute URL surface. Keep it under
    // `/api/...` so reverse proxies forwarding `^/api/.*` to this service hit it.
    await fastify.register(
      createBullBoardPlugin({
        user: config.get('BULL_BOARD_USER', { infer: true }),
        password: config.get('BULL_BOARD_PASSWORD', { infer: true }),
        basePath: '/api/admin/queues',
        redisHost: config.get('REDIS_QUEUE_HOST', { infer: true }),
        redisPort: config.get('REDIS_QUEUE_PORT', { infer: true }),
        queuePrefix: config.get('REDIS_QUEUE_PREFIX', { infer: true }),
      }),
    );
  }

  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : !isProduction,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Correlation-Id'],
    exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
    maxAge: 600,
  });

  app.useGlobalPipes(new ProblemDetailsValidationPipe());

  if (!isProduction) {
    setupSwagger(app);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`API running on: ${await app.getUrl()}`);
}

void bootstrap();
