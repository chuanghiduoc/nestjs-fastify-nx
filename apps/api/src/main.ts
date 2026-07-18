import './tracing';
import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { HttpStatus, VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { fastifyHelmet } from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import fastifyCompress from '@fastify/compress';
import fastifyUnderPressure from '@fastify/under-pressure';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { toNodeHandler } from 'better-auth/node';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { intEnv, positiveIntEnv, redisReconnectStrategy } from '@nestjs-fastify-nx/shared';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { reportFatalError, startSentry } from '@nestjs-fastify-nx/infra-observability';
import { AppModule } from './app/app.module';
import { resolveCorrelationId, resolveRequestId } from './common/logging/request-id';
import { ProblemDetailsValidationPipe } from './common/pipes';
import { setupSwagger } from './common/swagger/swagger.config';
import { createBullBoardPlugin } from './common/bull-board/create-bull-board-plugin';
import { registerIdempotency } from './common/idempotency/register-idempotency';
import { applyFastifyProblemDetailsHook } from './common/filters/fastify-error-handler';
import { buildProblemDetails } from './common/filters/problem-details.helper';
import type { EnvConfig } from './config/env.validation';

const STRICT_AUTH_PATHS = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
]);

const AUTH_ACCOUNT_RATE_LIMIT_SCRIPT = `
local count = redis.call('incr', KEYS[1])
if count == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end
return {count, redis.call('pttl', KEYS[1])}`;

startSentry({ serviceName: 'nestjs-fastify-api', profiling: true });

async function bootstrap() {
  // trustProxy depth must match proxy topology — wrong value lets XFF spoofing bypass IP rate limits.
  const bodyLimitBytes = positiveIntEnv('HTTP_BODY_LIMIT_BYTES', 1_048_576);
  const configuredProxyHops = intEnv('TRUST_PROXY_HOPS', 0);
  // Keep adapter construction safe so ConfigModule can report the original invalid value cleanly.
  const trustProxyHops =
    configuredProxyHops >= 0 && configuredProxyHops <= 10 ? configuredProxyHops : 0;

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
  // Register CORS before any direct Fastify routes (Better Auth/Bull Board). Fastify hooks are
  // order-sensitive; registering this near the end would leave earlier routes without CORS headers.
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
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Request-Id',
      'X-Correlation-Id',
    ],
    exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id', 'X-Correlation-Id'],
    maxAge: 600,
  });

  // CSP is disabled in dev so Scalar/Bull Board load freely. In prod the policy
  // is same-origin only: Bull Board serves its own bundled assets and Scalar
  // docs never mount in production, so no third-party CDN needs allowlisting.
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
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
            connectSrc: ["'self'"],
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

  // Idempotency-Key replay for mutating /api/v1/* writes (Stripe pattern). Registered before
  // @fastify/compress so its onSend hook stores the uncompressed JSON body. db=5 isolates the
  // keyspace from cache (0), throttler (1), and rate-limit (4). Fail-open on a Redis error.
  if (config.get('IDEMPOTENCY_ENABLED', { infer: true })) {
    const idempotencyRedis = new Redis({
      host: config.get('REDIS_CACHE_HOST', { infer: true }),
      port: config.get('REDIS_CACHE_PORT', { infer: true }),
      db: 5,
      maxRetriesPerRequest: 1,
      retryStrategy: redisReconnectStrategy,
      enableOfflineQueue: false,
    });
    idempotencyRedis.on('error', (err: Error) => {
      app.get(Logger).warn(`Idempotency Redis error: ${err.message}`);
    });
    fastify.addHook('onClose', async () => {
      await idempotencyRedis.quit().catch(() => idempotencyRedis.disconnect());
    });
    registerIdempotency(fastify, {
      redis: idempotencyRedis,
      ttlSeconds: config.get('IDEMPOTENCY_TTL_SECONDS', { infer: true }),
      lockTtlSeconds: config.get('IDEMPOTENCY_LOCK_TTL_SECONDS', { infer: true }),
      onError: (message) => app.get(Logger).warn(message),
    });
  }

  // Load shedding: on event-loop saturation, reply 503 (problem+json) so a load balancer / k8s
  // drains this instance. Heap/RSS caps are env-specific and left off by default.
  await fastify.register(fastifyUnderPressure, {
    maxEventLoopDelay: positiveIntEnv('HTTP_MAX_EVENT_LOOP_DELAY_MS', 1000),
    // Same problem+json shape as every other error so clients branch on `code` uniformly.
    pressureHandler: (req, reply) => {
      const requestId = resolveRequestId(req.headers);
      reply
        .code(HttpStatus.SERVICE_UNAVAILABLE)
        .header('content-type', 'application/problem+json')
        .header('x-request-id', requestId)
        .header('retry-after', '10')
        .send(
          buildProblemDetails({
            status: HttpStatus.SERVICE_UNAVAILABLE,
            title: 'Service Unavailable',
            detail: 'Server is under heavy load; please retry shortly.',
            code: ERROR_CODES.SERVICE_UNAVAILABLE,
            instance: req.url,
            requestId,
          }),
        );
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
  const authIpRateLimitMax = config.get('AUTH_IP_RATE_LIMIT_MAX', { infer: true });
  const authRateLimitWindowMs = config.get('AUTH_RATE_LIMIT_WINDOW_MS', { infer: true });
  const authRateLimitFailOpen = config.get('AUTH_RATE_LIMIT_FAIL_OPEN', { infer: true });

  // db=4 isolated from cache (db=0), throttler (db=1), and queue databases.
  const rateLimitRedis = new Redis({
    host: config.get('REDIS_CACHE_HOST', { infer: true }),
    port: config.get('REDIS_CACHE_PORT', { infer: true }),
    db: 4,
    maxRetriesPerRequest: 1,
    retryStrategy: redisReconnectStrategy,
    enableOfflineQueue: false,
  });
  rateLimitRedis.on('error', (err: Error) => {
    app.get(Logger).warn(`Rate-limit Redis error: ${err.message}`);
  });
  fastify.addHook('onClose', async () => {
    await rateLimitRedis.quit().catch(() => rateLimitRedis.disconnect());
  });

  await fastify.register(fastifyRateLimit, {
    global: false,
    redis: rateLimitRedis,
    // preHandler (not onRequest) so req.body is parsed before keyGenerator reads the email field.
    hook: 'preHandler',
    max: authRateLimitMax,
    timeWindow: authRateLimitWindowMs,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (req, context) => {
      // Stamp req.raw so the global exception filter echoes the SAME id on the x-request-id
      // header (rate-limit throws this body into setErrorHandler).
      const requestId = resolveRequestId(req.headers);
      (req.raw as { requestId?: string }).requestId = requestId;
      return {
        // Shared helper so a rate-limit 429 matches a ThrottlerGuard 429 byte for byte.
        ...buildProblemDetails({
          status: HttpStatus.TOO_MANY_REQUESTS,
          title: 'Too Many Requests',
          detail: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
          code: ERROR_CODES.RATE_LIMITED,
          instance: req.url,
          requestId,
        }),
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // Normalize parser/plugin failures that occur before Nest's exception filter without
  // installing a second Fastify error handler in the same scope (which triggers FSTWRN004).
  applyFastifyProblemDetailsHook(fastify);

  // A second, account-wide bucket complements the per-IP route bucket. Without both, attackers
  // can spray many accounts from one IP or distribute guesses for one account across many IPs.
  fastify.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?', 1)[0];
    if (!STRICT_AUTH_PATHS.has(path)) return;
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
    if (!email) return;

    try {
      const key = `auth:account:${createHash('sha256').update(email).digest('hex')}`;
      const [countRaw, ttlRaw] = (await rateLimitRedis.eval(
        AUTH_ACCOUNT_RATE_LIMIT_SCRIPT,
        1,
        key,
        String(authRateLimitWindowMs),
      )) as [number | string, number | string];
      const count = Number(countRaw);
      const ttl = Math.max(0, Number(ttlRaw));
      if (count <= authRateLimitMax) return;

      const retryAfter = Math.max(1, Math.ceil(ttl / 1000));
      const requestId = resolveRequestId(req.headers);
      (req.raw as { requestId?: string }).requestId = requestId;
      return reply
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .header('content-type', 'application/problem+json')
        .header('retry-after', String(retryAfter))
        .send({
          ...buildProblemDetails({
            status: HttpStatus.TOO_MANY_REQUESTS,
            title: 'Too Many Requests',
            detail: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
            code: ERROR_CODES.RATE_LIMITED,
            instance: req.url,
            requestId,
          }),
          retryAfter,
        });
    } catch (err) {
      if (authRateLimitFailOpen) {
        app.get(Logger).warn(`Account rate-limit Redis error (fail-open): ${String(err)}`);
        return;
      }

      app.get(Logger).error(`Account rate-limit Redis error (fail-closed): ${String(err)}`);
      const requestId = resolveRequestId(req.headers);
      (req.raw as { requestId?: string }).requestId = requestId;
      return reply
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .header('content-type', 'application/problem+json')
        .header('retry-after', '5')
        .send(
          buildProblemDetails({
            status: HttpStatus.SERVICE_UNAVAILABLE,
            title: 'Service Unavailable',
            detail: 'Authentication is temporarily unavailable. Retry shortly.',
            code: ERROR_CODES.SERVICE_UNAVAILABLE,
            instance: req.url,
            requestId,
          }),
        );
    }
  });

  const auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  const betterAuthHandler = toNodeHandler(auth.handler);

  // STRICT bucket: credential paths; LOOSE bucket: session ops.
  const authSessionRateLimitMax = config.get('AUTH_SESSION_RATE_LIMIT_MAX', { infer: true });
  const authSessionRateLimitWindowMs = config.get('AUTH_SESSION_RATE_LIMIT_WINDOW_MS', {
    infer: true,
  });
  const strictAuthRouteConfig: RouteShorthandOptions = {
    config: {
      rateLimit: {
        max: authIpRateLimitMax,
        timeWindow: authRateLimitWindowMs,
        keyGenerator: (req) => req.ip,
      },
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
    // These routes are registered directly on Fastify, so Nest middleware never seeds their
    // request context. Establish the same IDs before hijacking the response lifecycle.
    const requestId = resolveRequestId(req.headers);
    const correlationId = resolveCorrelationId(req.headers, requestId);
    Object.assign(req.raw, { requestId, correlationId });
    reply.header('x-request-id', requestId);
    reply.header('x-correlation-id', correlationId);

    // Propagate Fastify's parsed body to req.raw so Better Auth's toNodeHandler can read it.
    if (req.body !== undefined && (req.raw as unknown as { body?: unknown }).body === undefined) {
      (req.raw as unknown as { body: unknown }).body = req.body;
    }
    reply.hijack();
    try {
      await betterAuthHandler(req.raw, reply.raw);
    } catch (err) {
      // After hijack(), Fastify's error handler won't run — close manually to prevent slowloris hang.
      Sentry.captureException(err, { tags: { requestId, correlationId } });
      const logger = app.get(Logger);
      logger.error(
        { err, requestId, correlationId, url: req.url },
        'Better Auth handler threw unexpectedly',
      );
      if (!reply.raw.headersSent) {
        const body = JSON.stringify(
          buildProblemDetails({
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            title: 'Internal Server Error',
            code: ERROR_CODES.INTERNAL_SERVER_ERROR,
            instance: req.url,
            requestId,
          }),
        );
        reply.raw.writeHead(HttpStatus.INTERNAL_SERVER_ERROR, {
          'Content-Type': 'application/problem+json',
          'Content-Length': Buffer.byteLength(body),
          'X-Request-Id': requestId,
          'X-Correlation-Id': correlationId,
        });
        reply.raw.end(body);
      } else if (!reply.raw.writableEnded) {
        // The delegated handler may have started a response before throwing. It is too late to
        // replace the status/body, but ending the stream avoids leaving a half-open connection.
        reply.raw.end();
      }
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
  app.useGlobalPipes(new ProblemDetailsValidationPipe());

  if (!isProduction) {
    await setupSwagger(app);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`API listening at: ${await app.getUrl()}`);
}

void bootstrap().catch((error: unknown) => reportFatalError(error, 'nestjs-fastify-api'));
