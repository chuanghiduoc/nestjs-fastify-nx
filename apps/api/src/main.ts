import './tracing';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { fastifyHelmet } from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import fastifyCompress from '@fastify/compress';
import fastifyUnderPressure from '@fastify/under-pressure';
import { Redis } from 'ioredis';
import { toNodeHandler } from 'better-auth/node';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { AppModule } from './app/app.module';
import { applyFastifyErrorHandler } from './common/filters/fastify-error-handler';
import { resolveRequestId } from './common/logging/request-id';
import { ProblemDetailsValidationPipe } from './common/pipes';
import { setupSwagger } from './common/swagger/swagger.config';
import { createBullBoardPlugin } from './common/bull-board/create-bull-board-plugin';
import type { EnvConfig } from './config/env.validation';

const sentryDsn = process.env['SENTRY_DSN'];
if (sentryDsn) {
  const isProduction = process.env['NODE_ENV'] === 'production';
  // Cap prod sample rates to avoid burning through Sentry quota.
  const sampleRateCap = isProduction ? 0.1 : 1;
  const parsedRate = Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0.01);
  const tracesSampleRate = Math.min(Number.isFinite(parsedRate) ? parsedRate : 0.01, sampleRateCap);
  const profilesSampleRate = Math.min(0.1, sampleRateCap);

  Sentry.init({
    dsn: sentryDsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? 'development',
    tracesSampleRate,
    profilesSampleRate,
    integrations: [nodeProfilingIntegration()],
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
          delete event.request.headers['set-cookie'];
        }
      }

      const sensitiveKeys = /password|token|secret|cookie/i;
      const scrubObject = (obj: Record<string, unknown>): void => {
        for (const key of Object.keys(obj)) {
          if (sensitiveKeys.test(key)) {
            obj[key] = '[Filtered]';
          }
        }
      };

      if (event.extra) scrubObject(event.extra as Record<string, unknown>);
      if (event.contexts) {
        for (const ctx of Object.values(event.contexts)) {
          if (ctx && typeof ctx === 'object') scrubObject(ctx as Record<string, unknown>);
        }
      }
      const breadcrumbList = (event.breadcrumbs as { values?: unknown[] } | undefined)?.values;
      if (Array.isArray(breadcrumbList)) {
        for (const crumb of breadcrumbList) {
          const data = (crumb as { data?: unknown })?.data;
          if (data && typeof data === 'object') {
            scrubObject(data as Record<string, unknown>);
          }
        }
      }

      return event;
    },
  });
}

async function bootstrap() {
  // trustProxy depth must match proxy topology — wrong value lets XFF spoofing bypass IP rate limits.
  const bodyLimitBytes = positiveIntEnv('HTTP_BODY_LIMIT_BYTES', 1_048_576);
  const trustProxyHops = positiveIntEnv('TRUST_PROXY_HOPS', 1);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: trustProxyHops, bodyLimit: bodyLimitBytes }),
    { bufferLogs: true },
  );

  const config = app.get<ConfigService<EnvConfig, true>>(ConfigService);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  // URI versioning keeps /api/v1/... compatible with existing clients while opening a clean path for v2 alongside v1.
  app.setGlobalPrefix('api', { exclude: ['metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const fastify = app.getHttpAdapter().getInstance();
  // CSP disabled in dev so Scalar/Bull Board can load CDN assets.
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

  // Load shedding: on event-loop saturation, reply 503 (problem+json) so a load balancer / k8s
  // drains this instance. Heap/RSS caps are env-specific and left off by default.
  await fastify.register(fastifyUnderPressure, {
    maxEventLoopDelay: positiveIntEnv('HTTP_MAX_EVENT_LOOP_DELAY_MS', 1000),
    // Same problem+json shape as every other error so clients branch on `code` uniformly.
    pressureHandler: (req, reply) => {
      const requestId = resolveRequestId(req.headers);
      reply
        .code(503)
        .header('content-type', 'application/problem+json')
        .header('x-request-id', requestId)
        .header('retry-after', '10')
        .send({
          type: 'about:blank',
          title: 'Service Unavailable',
          status: 503,
          code: 'service_unavailable',
          detail: 'Server is under heavy load; please retry shortly.',
          instance: req.url,
          requestId,
          timestamp: new Date().toISOString(),
        });
    },
  });

  // Compress JSON/GraphQL responses above 1 KB. br omitted: CPU cost outweighs the gain on
  // dynamic JSON; a proxy/CDN can add it. Better Auth hijack routes bypass onSend (uncompressed).
  await fastify.register(fastifyCompress, {
    global: true,
    threshold: 1024,
    encodings: ['gzip', 'deflate'],
  });

  const uploadMaxBytes = positiveIntEnv('UPLOAD_MAX_FILE_BYTES', 10_485_760);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: uploadMaxBytes,
      files: 1,
      fields: 20,
      parts: 50,
    },
  });

  // Must register before betterAuthHandler — reply.hijack() bypasses NestJS ThrottlerGuard.
  const authRateLimitMax = config.get('AUTH_RATE_LIMIT_MAX', { infer: true });
  const authRateLimitWindowMs = config.get('AUTH_RATE_LIMIT_WINDOW_MS', { infer: true });

  // db=4 isolated from cache (db=0), throttler (db=1), and queue databases.
  const rateLimitRedis = new Redis({
    host: config.get('REDIS_CACHE_HOST', { infer: true }),
    port: config.get('REDIS_CACHE_PORT', { infer: true }),
    db: 4,
    maxRetriesPerRequest: 1,
    retryStrategy: (times: number) => (times >= 10 ? null : Math.min(times * 200, 3000)),
    enableOfflineQueue: false,
  });
  rateLimitRedis.on('error', (err: Error) => {
    app.get(Logger).warn(`Rate-limit Redis error: ${err.message}`);
  });
  // Nest shutdown only tears down DI providers; close this connection manually.
  process.once('SIGTERM', () => {
    void rateLimitRedis.quit().catch(() => rateLimitRedis.disconnect());
  });

  await fastify.register(fastifyRateLimit, {
    global: false,
    redis: rateLimitRedis,
    // preHandler (not onRequest) so req.body is parsed before keyGenerator reads the email field.
    hook: 'preHandler',
    max: authRateLimitMax,
    timeWindow: authRateLimitWindowMs,
    // Key by IP+email — prevents same-NAT users sharing a bucket while still capping per-account abuse.
    keyGenerator: (req) => {
      const body = req.body as Record<string, unknown> | undefined;
      const email = body && typeof body['email'] === 'string' ? body['email'].toLowerCase() : '';
      return `${req.ip}:${email}`;
    },
    errorResponseBuilder: (req, context) => {
      // Stamp req.raw so applyFastifyErrorHandler echoes the SAME id on the x-request-id
      // header (rate-limit throws this body into setErrorHandler).
      const requestId = resolveRequestId(req.headers);
      (req.raw as { requestId?: string }).requestId = requestId;
      return {
        type: 'https://tools.ietf.org/html/rfc6585#section-4',
        title: 'Too Many Requests',
        status: 429,
        // Match ProblemDetailsDto so rate-limit 429s carry the same shape as every other error.
        code: 'too_many_requests',
        detail: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
        retryAfter: Math.ceil(context.ttl / 1000),
        requestId,
        timestamp: new Date().toISOString(),
      };
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // @fastify/rate-limit emits application/json; rewrite to problem+json for RFC 9457 contract.
  fastify.addHook('onSend', (_req, reply, _payload, done) => {
    if (
      reply.statusCode === 429 &&
      !reply.getHeader('content-type')?.toString().includes('problem+json')
    ) {
      reply.header('content-type', 'application/problem+json');
    }
    done();
  });

  applyFastifyErrorHandler(fastify);

  const auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  const betterAuthHandler = toNodeHandler(auth.handler);

  // STRICT bucket: credential paths; LOOSE bucket: session ops.
  const STRICT_AUTH_PATHS = [
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/request-password-reset',
    '/api/auth/reset-password',
  ] as const;
  const authSessionRateLimitMax = config.get('AUTH_SESSION_RATE_LIMIT_MAX', { infer: true });
  const authSessionRateLimitWindowMs = config.get('AUTH_SESSION_RATE_LIMIT_WINDOW_MS', {
    infer: true,
  });
  const strictAuthRouteConfig: RouteShorthandOptions = {
    config: {
      rateLimit: { max: authRateLimitMax, timeWindow: authRateLimitWindowMs },
    },
  };
  const looseAuthRouteConfig: RouteShorthandOptions = {
    config: {
      rateLimit: {
        max: authSessionRateLimitMax,
        timeWindow: authSessionRateLimitWindowMs,
        keyGenerator: (req) => req.ip,
      },
    },
  };

  const authRouteHandler = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Propagate Fastify's parsed body to req.raw so Better Auth's toNodeHandler can read it.
    if (req.body !== undefined && (req.raw as unknown as { body?: unknown }).body === undefined) {
      (req.raw as unknown as { body: unknown }).body = req.body;
    }
    reply.hijack();
    try {
      await betterAuthHandler(req.raw, reply.raw);
    } catch (err) {
      // After hijack(), Fastify's error handler won't run — close manually to prevent slowloris hang.
      Sentry.captureException(err);
      const logger = app.get(Logger);
      logger.error(
        `Better Auth handler threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
      );
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
      reply.raw.socket?.destroy(); // Destroy half-open socket.
    }
  };

  for (const path of STRICT_AUTH_PATHS) {
    fastify.all(path, strictAuthRouteConfig, authRouteHandler);
  }
  fastify.all('/api/auth/*', looseAuthRouteConfig, authRouteHandler);

  if (config.get('BULL_BOARD_ENABLED', { infer: true })) {
    // Fastify plugin — setGlobalPrefix/enableVersioning does NOT apply to Fastify-registered plugins.
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

  // Never reflect arbitrary origins with credentials:true — prevents CSRF via cross-site authenticated requests.
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  const DEV_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:4200',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4200',
    'http://127.0.0.1:5173',
  ];
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : isProduction ? [] : DEV_ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Correlation-Id'],
    exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
    maxAge: 600,
  });

  app.useGlobalPipes(new ProblemDetailsValidationPipe());

  if (!isProduction) {
    await setupSwagger(app);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`API running on: ${await app.getUrl()}`);
}

void bootstrap();
