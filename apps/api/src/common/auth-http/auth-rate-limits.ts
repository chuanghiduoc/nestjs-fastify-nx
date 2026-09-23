import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import type Redis from 'ioredis';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { sanitizeUrlForLogging } from '@nestjs-fastify-nx/shared';
import { redisFixedWindowIncr } from '../rate-limit/redis-fixed-window';
import { ensureRequestIds } from '../logging/request-id';
import { buildProblemDetails, sendProblem } from '../filters/problem-details.helper';

export const STRICT_AUTH_PATHS = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
]);

export const RETRY_AFTER_AUTH_UNAVAILABLE_SECONDS = 5;

const keyByExactAddress = (req: FastifyRequest): string => req.ip;

export interface AuthRateLimitConfig {
  readonly authRateLimitMax: number;
  readonly authIpRateLimitMax: number;
  readonly authRateLimitWindowMs: number;
  readonly authRateLimitFailOpen: boolean;
  readonly authSessionRateLimitMax: number;
  readonly authSessionRateLimitWindowMs: number;
}

export interface AuthRouteConfigs {
  readonly strictAuthRouteConfig: RouteShorthandOptions;
  readonly looseAuthRouteConfig: RouteShorthandOptions;
}

// Must register before betterAuthHandler — reply.hijack() bypasses NestJS ThrottlerGuard.
export async function registerAuthRateLimits(
  fastify: FastifyInstance,
  redis: Redis,
  config: AuthRateLimitConfig,
  logger: Logger,
): Promise<AuthRouteConfigs> {
  const {
    authRateLimitMax,
    authIpRateLimitMax,
    authRateLimitWindowMs,
    authRateLimitFailOpen,
    authSessionRateLimitMax,
    authSessionRateLimitWindowMs,
  } = config;

  await fastify.register(fastifyRateLimit, {
    global: false,
    redis,
    // Fail open on a store error instead of letting @fastify/rate-limit rethrow it as a 500 — a
    // transient Redis reconnect would otherwise 500 every /api/auth/* call. The account bucket below
    // still guards credential paths.
    skipOnError: true,
    // preHandler (not onRequest) so req.body is parsed before keyGenerator reads the email field.
    hook: 'preHandler',
    max: authRateLimitMax,
    timeWindow: authRateLimitWindowMs,
    keyGenerator: keyByExactAddress,
    errorResponseBuilder: (req, context) => {
      // Reuse the id already on req.raw so the global exception filter echoes the SAME id on the
      // x-request-id header (rate-limit throws this body into setErrorHandler).
      const { requestId } = ensureRequestIds(req.raw, req.headers);
      return {
        // Shared helper so a rate-limit 429 matches a ThrottlerGuard 429 byte for byte.
        ...buildProblemDetails({
          status: HttpStatus.TOO_MANY_REQUESTS,
          title: 'Too Many Requests',
          detail: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
          code: ERROR_CODES.RATE_LIMITED,
          instance: sanitizeUrlForLogging(req.url),
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

  // A second, account-wide bucket complements the per-IP route bucket. Without both, attackers
  // can spray many accounts from one IP or distribute guesses for one account across many IPs.
  // This bucket keys on the request's email, so it only augments credential paths that carry one
  // (sign-in, sign-up, request-password-reset). reset-password submits only { token, newPassword }
  // and is covered by the per-IP bucket alone — its token is unguessable, so that is sufficient.
  fastify.addHook('preHandler', async (req, reply) => {
    // Match on the ROUTE Fastify resolved, not the raw URL: find-my-way percent-decodes before
    // routing, so a raw-string check on req.url (`/sign-in/%65mail`) would miss a request that
    // actually hit the strict credential route and let it skip the account-wide limiter.
    const matchedRoute = req.routeOptions?.url;
    if (!matchedRoute || !STRICT_AUTH_PATHS.has(matchedRoute)) return;
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
    if (!email) return;

    try {
      const key = `auth:account:${createHash('sha256').update(email).digest('hex')}`;
      const { count, ttlMs } = await redisFixedWindowIncr(redis, key, authRateLimitWindowMs);
      if (count <= authRateLimitMax) return;

      const retryAfter = Math.max(1, Math.ceil(ttlMs / 1000));
      return sendProblem(req, reply, {
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        headers: { 'retry-after': String(retryAfter) },
        extra: { retryAfter },
      });
    } catch (err) {
      if (authRateLimitFailOpen) {
        logger.warn({ err }, 'Account rate-limit Redis error (fail-open)');
        return;
      }

      logger.error({ err }, 'Account rate-limit Redis error (fail-closed)');
      return sendProblem(req, reply, {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'Authentication is temporarily unavailable. Retry shortly.',
        headers: { 'retry-after': String(RETRY_AFTER_AUTH_UNAVAILABLE_SECONDS) },
      });
    }
  });

  const strictAuthRouteConfig: RouteShorthandOptions = {
    config: {
      rateLimit: {
        max: authIpRateLimitMax,
        timeWindow: authRateLimitWindowMs,
        keyGenerator: keyByExactAddress,
      },
    },
  };
  const looseAuthRouteConfig: RouteShorthandOptions = {
    config: {
      rateLimit: {
        max: authSessionRateLimitMax,
        timeWindow: authSessionRateLimitWindowMs,
        keyGenerator: keyByExactAddress,
      },
    },
  };

  return { strictAuthRouteConfig, looseAuthRouteConfig };
}
