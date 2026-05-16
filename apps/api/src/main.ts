import './tracing';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { fastifyHelmet } from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import { toNodeHandler } from 'better-auth/node';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { AppModule } from './app/app.module';
import { applyFastifyErrorHandler } from './common/filters/fastify-error-handler';
import { ProblemDetailsValidationPipe } from './common/pipes';
import { setupSwagger } from './common/swagger/swagger.config';
import { createBullBoardPlugin } from './common/bull-board/create-bull-board-plugin';
import type { EnvConfig } from './config/env.validation';

const sentryDsn = process.env['SENTRY_DSN'];
if (sentryDsn) {
  const isProduction = process.env['NODE_ENV'] === 'production';
  // Cap sampling rates in production to limit Sentry quota burn. The env vars
  // allow per-deployment tuning; the Math.min ensures the cap is never exceeded
  // even if someone sets SENTRY_TRACES_SAMPLE_RATE=1 in prod.
  const sampleRateCap = isProduction ? 0.1 : 1;
  const tracesSampleRate = Math.min(
    Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0.1),
    sampleRateCap,
  );
  const profilesSampleRate = Math.min(0.1, sampleRateCap);

  Sentry.init({
    dsn: sentryDsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? 'development',
    tracesSampleRate,
    profilesSampleRate,
    integrations: [nodeProfilingIntegration()],
    // Never send PII (cookies, auth headers, request bodies) to Sentry.
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip request-level PII that Sentry may capture automatically.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
          delete event.request.headers['set-cookie'];
        }
      }
      return event;
    },
  });
}

/**
 * Safe env integer reader for values consumed before ConfigService is
 * available. Falls back to `defaultValue` when the env var is absent,
 * empty, or parses to NaN / a non-positive number.
 */
function parseIntEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

async function bootstrap() {
  // Read body limit from env early — before the adapter is created — so the
  // Fastify http parser enforces it before any route handler fires.
  const bodyLimitBytes = parseIntEnv(process.env['HTTP_BODY_LIMIT_BYTES'], 1_048_576);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: 1, bodyLimit: bodyLimitBytes }),
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

  // Multipart plugin scoped to upload endpoints. Limits prevent DoS via
  // oversized file uploads independent of the JSON bodyLimit above.
  const uploadMaxBytes = parseIntEnv(process.env['UPLOAD_MAX_FILE_BYTES'], 10_485_760);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: uploadMaxBytes,
      files: 1,
      fields: 20,
      parts: 50,
    },
  });

  // Rate-limit for /api/auth/* must be registered BEFORE the betterAuthHandler
  // hook because reply.hijack() bypasses the NestJS request pipeline entirely,
  // meaning Nest's ThrottlerGuard never sees auth requests.
  const authRateLimitMax = config.get('AUTH_RATE_LIMIT_MAX', { infer: true });
  const authRateLimitWindowMs = config.get('AUTH_RATE_LIMIT_WINDOW_MS', { infer: true });

  await fastify.register(fastifyRateLimit, {
    // Global rate-limit disabled — we apply it only on the auth prefix below.
    // This registration just wires the plugin; per-route limits override it.
    global: false,
    // preHandler runs after body parsing, so req.body is populated when
    // keyGenerator fires. The default 'onRequest' hook fires before parsing —
    // req.body would always be undefined and the email branch would be dead.
    hook: 'preHandler',
    max: authRateLimitMax,
    timeWindow: authRateLimitWindowMs,
    // Key by IP + email body field so distributed clients on the same NAT
    // are not unfairly bucketed together, while still capping per-IP abuse.
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
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // B2: The rate-limit plugin serializes errorResponseBuilder's return value via
  // Fastify's default JSON serializer, which sets Content-Type: application/json.
  // This onSend hook rewrites the Content-Type to application/problem+json for
  // every 429 response so the repo's RFC 9457 contract is upheld uniformly.
  fastify.addHook('onSend', (_req, reply, _payload, done) => {
    if (
      reply.statusCode === 429 &&
      !reply.getHeader('content-type')?.toString().includes('problem+json')
    ) {
      reply.header('content-type', 'application/problem+json');
    }
    done();
  });

  // Convert Fastify-level errors (body parser, content-type, schema validation)
  // into RFC 9457 Problem Details. These fire BEFORE the NestJS exception
  // filter sees the request, so without this hook they leak Fastify defaults.
  applyFastifyErrorHandler(fastify);

  // Mount Better Auth handler at /api/auth/* before NestJS routes resolve.
  // Must run before global validation pipes — Better Auth handles its own body parsing.
  const auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  const betterAuthHandler = toNodeHandler(auth.handler);
  fastify.all(
    '/api/auth/*',
    {
      config: {
        // Apply the auth-specific rate limit on these routes.
        rateLimit: {
          max: authRateLimitMax,
          timeWindow: authRateLimitWindowMs,
        },
      },
    },
    async (req, reply) => {
      // Fastify consumes the request stream into `req.body`. Better Auth's
      // toNodeHandler reads from req.raw — propagate the parsed body so its
      // fallback path can re-serialize it into a Web Request.
      if (req.body !== undefined && (req.raw as unknown as { body?: unknown }).body === undefined) {
        (req.raw as unknown as { body: unknown }).body = req.body;
      }
      reply.hijack();
      try {
        await betterAuthHandler(req.raw, reply.raw);
      } catch (err) {
        // betterAuthHandler threw after hijack — Fastify's error handler will
        // not run because the reply is already hijacked. We must close the
        // connection manually to prevent a slowloris-style hang.
        Sentry.captureException(err);
        const logger = app.get(Logger);
        logger.error(
          `Better Auth handler threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        );
        // reply.sent is always false after hijack (Fastify tracks sent state
        // internally and hijack detaches that tracking). The meaningful guard
        // is reply.raw.headersSent — kept for defensive clarity.
        if (!reply.raw.headersSent) {
          const body = JSON.stringify({
            type: 'https://tools.ietf.org/html/rfc7231#section-6.6.1',
            title: 'Internal Server Error',
            status: 500,
          });
          reply.raw.writeHead(500, {
            'Content-Type': 'application/problem+json',
            'Content-Length': Buffer.byteLength(body),
          });
          reply.raw.end(body);
        }
        // Forcibly destroy the socket so half-open connections don't linger.
        reply.raw.socket?.destroy();
      }
    },
  );

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
