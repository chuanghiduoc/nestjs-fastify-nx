import { HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { timingSafeEqual } from 'node:crypto';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { QUEUE_NAMES } from '../../app/constants/queue.constants';
import { redisFixedWindowIncr } from '../rate-limit/redis-fixed-window';
import { resolveRequestId } from '../logging/request-id';
import {
  buildProblemDetails,
  HTTP_STATUS_TITLES,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetailsBody,
} from '../filters/problem-details.helper';
import { resolveFastifyCode, resolveFastifyStatus } from '../filters/fastify-error-handler';

// Budget for FAILED Basic-Auth attempts only — the dashboard polls its queue API every few seconds
// and pulls a dozen static assets per page load, so charging authenticated traffic would lock the
// operator out within seconds while leaving credential guessing untouched.
const BULL_BOARD_AUTH_FAILURE_MAX = 10;
const BULL_BOARD_AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_KEY_PREFIX = 'bull-board:auth-fail:';

const logger = new Logger('BullBoard');

export interface BullBoardOptions {
  user: string;
  password: string;
  basePath: string;
  redisHost: string;
  redisPort: number;
  queuePrefix: string;
  // Shared rate-limit Redis (db 4) — an in-memory counter would multiply the brute-force ceiling
  // by the replica count.
  redis: Redis;
}

interface BasicCredentials {
  user: string;
  password: string;
}

interface AuthFailureState {
  count: number;
  ttlMs: number;
}

interface ProblemArgs {
  status: number;
  title: string;
  detail: string;
  code: string;
  headers?: Record<string, string>;
}

// `@bull-board/fastify` installs its own `setErrorHandler` inside the scope it owns, so the Nest
// exception filter never sees a failure raised there. Its default handler collapses everything to
// `error.statusCode || 500`, which turns an RFC 9457 error (carrying `status`, not `statusCode`)
// into a 500.
export function createProblemDetailsErrorHandler(): (error: unknown) => {
  status: number;
  body: ProblemDetailsBody;
} {
  return (error: unknown) => {
    const candidate = (error ?? {}) as FastifyError & { title?: unknown; detail?: unknown };
    const status = resolveFastifyStatus(candidate);
    const isServerError = status >= HttpStatus.INTERNAL_SERVER_ERROR;
    const title =
      typeof candidate.title === 'string' && candidate.title
        ? candidate.title
        : (HTTP_STATUS_TITLES[status] ?? 'Error');
    const rawDetail =
      (typeof candidate.detail === 'string' && candidate.detail) ||
      (typeof candidate.message === 'string' && candidate.message) ||
      title;

    if (isServerError) {
      // The root onSend normalizer passes a well-formed Problem Details body straight through, so
      // without this the 5xx would leave no trace in logs or Sentry.
      logger.error({ err: error, status }, 'Bull Board request failed');
      Sentry.captureException(error);
    }

    return {
      status,
      body: buildProblemDetails({
        status,
        title,
        // A 5xx message can carry driver/library internals — mask it the same way the global filter does.
        detail: isServerError && process.env['NODE_ENV'] === 'production' ? title : rawDetail,
        code:
          status < HttpStatus.INTERNAL_SERVER_ERROR &&
          typeof candidate.code === 'string' &&
          !candidate.code.startsWith('FST_')
            ? candidate.code
            : resolveFastifyCode(candidate, status),
      }),
    };
  };
}

export function parseBasicAuth(header: unknown): BasicCredentials | undefined {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  return colonIdx === -1
    ? { user: decoded, password: '' }
    : { user: decoded.slice(0, colonIdx), password: decoded.slice(colonIdx + 1) };
}

// Constant-time compare — `===` leaks timing info via early exit.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Dummy compare against attacker-controlled buffer — work factor scales with their input length,
    // which they already know; using bufB here would leak the secret length via response time.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function recordAuthFailure(redis: Redis, ip: string): Promise<AuthFailureState> {
  return redisFixedWindowIncr(
    redis,
    `${AUTH_FAILURE_KEY_PREFIX}${ip}`,
    BULL_BOARD_AUTH_FAILURE_WINDOW_MS,
  );
}

// Returned so the caller can `return sendProblem(...)` from an async hook — Fastify treats the
// returned reply as the terminal response instead of continuing the chain.
function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  args: ProblemArgs,
): FastifyReply {
  const requestId = resolveRequestId(request.headers);
  reply.header('content-type', PROBLEM_CONTENT_TYPE);
  for (const [name, value] of Object.entries(args.headers ?? {})) {
    reply.header(name, value);
  }
  return reply.status(args.status).send(
    buildProblemDetails({
      status: args.status,
      title: args.title,
      detail: args.detail,
      code: args.code,
      instance: request.url,
      requestId,
    }),
  );
}

export function createBullBoardPlugin(opts: BullBoardOptions) {
  return async function bullBoardPlugin(fastify: FastifyInstance) {
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath(opts.basePath);

    const rawQueues = Object.values(QUEUE_NAMES).map(
      (name) =>
        new Queue(name, {
          connection: { host: opts.redisHost, port: opts.redisPort },
          prefix: opts.queuePrefix,
        }),
    );
    const queues = rawQueues.map((q) => new BullMQAdapter(q));

    createBullBoard({ queues, serverAdapter });
    // Must run after createBullBoard — it installs the library default handler unconditionally.
    // The cast covers a library type narrower than its own contract: `HTTPStatus` omits the statuses
    // this surface emits (401/429/503) while the adapter only does `reply.status(status || 500)`.
    serverAdapter.setErrorHandler(
      createProblemDetailsErrorHandler() as Parameters<typeof serverAdapter.setErrorHandler>[0],
    );

    fastify.addHook('onClose', async () => {
      await Promise.all(
        rawQueues.map(async (queue) => {
          try {
            await queue.close();
          } catch {
            await queue.disconnect().catch(() => undefined);
          }
        }),
      );
    });

    // Throttling belongs in this instance-level hook, not in a route-scoped rate-limit plugin:
    // Fastify runs instance hooks before route hooks, so a plugin would only see requests this hook
    // already let through — throttling authenticated operators and never the guesser. Replies are
    // sent, not thrown, so the shape never depends on which error handler owns the enclosing scope.
    fastify.addHook('onRequest', async (request, reply) => {
      const credentials = parseBasicAuth(request.headers['authorization']);
      if (credentials) {
        // Both checks must run regardless of first result to stay constant-time.
        const userOk = safeEqual(credentials.user, opts.user);
        const passOk = safeEqual(credentials.password, opts.password);
        if (userOk && passOk) return;
      }

      let failure: AuthFailureState;
      try {
        failure = await recordAuthFailure(opts.redis, request.ip);
      } catch (err) {
        // Fail closed: without a counter there is no ceiling on credential guessing, and on an admin
        // surface that ceiling outweighs availability — unlike the public auth routes, where failing
        // closed would deny every legitimate sign-in too.
        logger.error({ err, url: request.url }, 'Bull Board auth throttle store unavailable');
        return sendProblem(request, reply, {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          title: 'Service Unavailable',
          detail: 'Bull Board is temporarily unavailable. Retry shortly.',
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          headers: { 'retry-after': '5' },
        });
      }

      if (failure.count > BULL_BOARD_AUTH_FAILURE_MAX) {
        const retryAfter = Math.max(1, Math.ceil(failure.ttlMs / 1000));
        return sendProblem(request, reply, {
          status: HttpStatus.TOO_MANY_REQUESTS,
          title: 'Too Many Requests',
          detail: `Too many failed sign-in attempts. Try again in ${retryAfter} seconds.`,
          code: ERROR_CODES.RATE_LIMITED,
          headers: { 'retry-after': String(retryAfter) },
        });
      }

      return sendProblem(request, reply, {
        status: HttpStatus.UNAUTHORIZED,
        title: 'Unauthorized',
        detail: 'Valid Basic Auth credentials are required to access Bull Board.',
        code: ERROR_CODES.UNAUTHORIZED,
        headers: { 'WWW-Authenticate': 'Basic realm="Bull Board"' },
      });
    });

    await fastify.register(serverAdapter.registerPlugin(), {
      prefix: opts.basePath,
      logLevel: 'silent',
    });
  };
}
