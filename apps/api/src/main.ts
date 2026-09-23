import './tracing';
import { NestFactory } from '@nestjs/core';
import { HttpStatus, VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { fastifyHelmet } from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { IoAdapter } from '@nestjs/platform-socket.io';
import fastifyCompress from '@fastify/compress';
import fastifyUnderPressure from '@fastify/under-pressure';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { positiveIntEnv } from '@nestjs-fastify-nx/shared';
import { reportFatalError, startSentry } from '@nestjs-fastify-nx/infra-observability';
import { AppModule } from './app/app.module';
import { ProblemDetailsValidationPipe } from './common/pipes';
import { setupSwagger } from './common/swagger/swagger.config';
import { createBullBoardPlugin } from './common/bull-board/create-bull-board-plugin';
import { registerIdempotency } from './common/idempotency/register-idempotency';
import { REDIS_DB, createManagedApiRedis } from './common/redis/api-redis.factory';
import { resolveTrustedProxies } from './common/http/trusted-proxies';
import { DEV_ALLOWED_ORIGINS } from './common/http/cors-origins';
import { GLOBAL_PREFIX, GLOBAL_PREFIX_EXCLUDES } from './common/http/global-prefix';
import { applyFastifyProblemDetailsHook } from './common/filters/fastify-error-handler';
import { sendProblem } from './common/filters/problem-details.helper';
import { registerDevRequestLogger } from './common/logging/dev-request-logger';
import { STRICT_AUTH_PATHS, registerAuthRateLimits } from './common/auth-http/auth-rate-limits';
import { createBetterAuthRouteHandler } from './common/auth-http/better-auth-route-handler';
import type { EnvConfig } from './config/env.validation';

// Relaxed CSP applied ONLY to the Bull Board admin path (its bundled UI uses inline script/style).
// Kept as tight as Bull Board allows: inline script/style but no third-party origins.
const BULL_BOARD_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; " +
  "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; font-src 'self' https: data:; connect-src 'self'";

const CORS_PREFLIGHT_MAX_AGE_SECONDS = 600;
const HSTS_MAX_AGE_SECONDS = 2 * 365 * 24 * 60 * 60;
const RETRY_AFTER_OVERLOAD_SECONDS = 10;

startSentry({ serviceName: 'nestjs-fastify-api', profiling: true });

async function bootstrap() {
  const bodyLimitBytes = positiveIntEnv('HTTP_BODY_LIMIT_BYTES', 1_048_576);
  // Keep adapter construction safe so ConfigModule can report the original invalid value cleanly.
  const trustedProxies = resolveTrustedProxies(process.env['TRUST_PROXY_CIDRS']);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // ignoreTrailingSlash so `/api/auth/sign-in/email/` matches the same strict route as the
    // non-slash form — otherwise the trailing-slash variant falls through to the looser wildcard
    // bucket and skips the account-wide credential-stuffing limiter.
    new FastifyAdapter({
      trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
      bodyLimit: bodyLimitBytes,
      ignoreTrailingSlash: true,
    }),
    { bufferLogs: true },
  );

  const config = app.get<ConfigService<EnvConfig, true>>(ConfigService);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  // URI versioning keeps /api/v1/... compatible with existing clients while opening a clean path for v2 alongside v1.
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: [...GLOBAL_PREFIX_EXCLUDES] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const fastify = app.getHttpAdapter().getInstance();

  // Dev-only: colorful request logging at Fastify level (before guards/interceptors).
  // Runs for EVERY request including 401s, rate-limits, etc.
  if (!isProduction) {
    registerDevRequestLogger(fastify);
  }

  // Register CORS before any direct Fastify routes (Better Auth/Bull Board). Fastify hooks are
  // order-sensitive; registering this near the end would leave earlier routes without CORS headers.
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  // Prod defaults to an empty allow-list (deny) rather than reflecting the request origin: with
  // credentials:true, reflecting arbitrary origins would open credentialed cross-site requests (CSRF).
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
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
  });

  // CSP is disabled in dev so Scalar/Bull Board load freely. In prod the JSON API surface gets a
  // strict same-origin policy WITHOUT script/style 'unsafe-inline' (an inline-script XSS in any HTML
  // response would otherwise execute). The one HTML surface — Bull Board — ships inline bootstrap
  // script/style we cannot attach a nonce to (its HTML is not ours to template), so its admin path is
  // relaxed by the scoped hook below rather than weakening the global policy for everything.
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
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", 'https:'],
            connectSrc: ["'self'"],
            upgradeInsecureRequests: [],
            workerSrc: ["'self'", 'blob:'],
          },
        }
      : false,
    hsts: {
      maxAge: HSTS_MAX_AGE_SECONDS,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  // Bull Board's bundled admin UI requires inline script/style. Override the strict global CSP for
  // that path ONLY (prod, where the global policy is active); the JSON API keeps the strict policy.
  if (isProduction) {
    fastify.addHook('onSend', async (req, reply, payload) => {
      if (req.url.startsWith('/api/admin/queues')) {
        reply.header('content-security-policy', BULL_BOARD_CSP);
      }
      return payload;
    });
  }

  await fastify.register(fastifyCookie);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: config.get('UPLOAD_MAX_FILE_BYTES', { infer: true }),
    },
  });

  if (config.get('IDEMPOTENCY_ENABLED', { infer: true })) {
    const idempotencyRedis = createManagedApiRedis(fastify, app.get(Logger), {
      config: {
        host: config.get('REDIS_CACHE_HOST', { infer: true }),
        port: config.get('REDIS_CACHE_PORT', { infer: true }),
        password: config.get('REDIS_CACHE_PASSWORD', { infer: true }),
      },
      db: REDIS_DB.IDEMPOTENCY,
      label: 'Idempotency',
    });
    app.useGlobalInterceptors(
      registerIdempotency(fastify, {
        redis: idempotencyRedis,
        ttlSeconds: config.get('IDEMPOTENCY_TTL_SECONDS', { infer: true }),
        lockTtlSeconds: config.get('IDEMPOTENCY_LOCK_TTL_SECONDS', { infer: true }),
        uploadRequestTimeoutMs: config.get('UPLOAD_REQUEST_TIMEOUT_MS', { infer: true }),
        onError: (message) => app.get(Logger).warn(message),
      }),
    );
  }

  // Normalize parser/plugin failures that surface before Nest's exception filter into RFC 9457
  // problem+json, WITHOUT installing a second Fastify error handler in the same scope (that would
  // trigger FSTWRN004 and shadow Nest's). Registered before @fastify/compress — like the idempotency
  // hook above — so its onSend rewrites the UNcompressed body: after compress it could be handed a
  // gzipped buffer it cannot JSON.parse, dropping the real code/detail and emitting a plaintext body
  // under a stale Content-Encoding: gzip header.
  applyFastifyProblemDetailsHook(fastify);

  // Load shedding: on event-loop saturation, reply 503 (problem+json) so a load balancer / k8s
  // drains this instance. Heap/RSS caps are env-specific and left off by default.
  await fastify.register(fastifyUnderPressure, {
    maxEventLoopDelay: positiveIntEnv('HTTP_MAX_EVENT_LOOP_DELAY_MS', 1000),
    // Same problem+json shape as every other error so clients branch on `code` uniformly.
    pressureHandler: (req, reply) => {
      sendProblem(req, reply, {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'Server is under heavy load; please retry shortly.',
        headers: { 'retry-after': String(RETRY_AFTER_OVERLOAD_SECONDS) },
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

  const rateLimitRedis = createManagedApiRedis(fastify, app.get(Logger), {
    config: {
      host: config.get('REDIS_CACHE_HOST', { infer: true }),
      port: config.get('REDIS_CACHE_PORT', { infer: true }),
      password: config.get('REDIS_CACHE_PASSWORD', { infer: true }),
    },
    db: REDIS_DB.RATE_LIMIT,
    label: 'Rate-limit',
  });

  const { strictAuthRouteConfig, looseAuthRouteConfig } = await registerAuthRateLimits(
    fastify,
    rateLimitRedis,
    {
      authRateLimitMax: config.get('AUTH_RATE_LIMIT_MAX', { infer: true }),
      authIpRateLimitMax: config.get('AUTH_IP_RATE_LIMIT_MAX', { infer: true }),
      authRateLimitWindowMs: config.get('AUTH_RATE_LIMIT_WINDOW_MS', { infer: true }),
      authRateLimitFailOpen: config.get('AUTH_RATE_LIMIT_FAIL_OPEN', { infer: true }),
      authSessionRateLimitMax: config.get('AUTH_SESSION_RATE_LIMIT_MAX', { infer: true }),
      authSessionRateLimitWindowMs: config.get('AUTH_SESSION_RATE_LIMIT_WINDOW_MS', {
        infer: true,
      }),
    },
    app.get(Logger),
  );

  const auth = app.get<BetterAuthInstance>(BETTER_AUTH_INSTANCE);
  const authRouteHandler = createBetterAuthRouteHandler(auth, {
    timeoutMs: config.get('HTTP_REQUEST_TIMEOUT_MS', { infer: true }),
    logger: app.get(Logger),
  });

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
        redisPassword: config.get('REDIS_QUEUE_PASSWORD', { infer: true }),
        queuePrefix: config.get('REDIS_QUEUE_PREFIX', { infer: true }),
        // Reuses the rate-limit connection (db 4) so the failed-auth budget is shared across replicas.
        redis: rateLimitRedis,
      }),
    );
  }

  app.useGlobalPipes(new ProblemDetailsValidationPipe());
  app.useWebSocketAdapter(new IoAdapter(app));

  if (!isProduction) {
    await setupSwagger(app);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port, config.get('HOST', { infer: true }));
  app.get(Logger).log(`API listening at: ${await app.getUrl()}`);
}

void bootstrap().catch((error: unknown) => reportFatalError(error, 'nestjs-fastify-api'));
