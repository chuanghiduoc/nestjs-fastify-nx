import { HttpStatus } from '@nestjs/common';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Queue } from 'bullmq';
import { timingSafeEqual } from 'node:crypto';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { QUEUE_NAMES } from '../../app/constants/queue.constants';
import { resolveRequestId } from '../logging/request-id';
import { buildProblemDetails, PROBLEM_CONTENT_TYPE } from '../filters/problem-details.helper';

// Admin-only surface with low expected traffic — an in-memory store is enough; unlike the
// auth routes in main.ts this does not need cross-replica coordination via Redis.
const BULL_BOARD_RATE_LIMIT_MAX = 10;
const BULL_BOARD_RATE_LIMIT_WINDOW_MS = 60_000;

function sendUnauthorized(request: FastifyRequest, reply: FastifyReply): void {
  const requestId = resolveRequestId(request.headers);
  reply
    .header('WWW-Authenticate', 'Basic realm="Bull Board"')
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .status(HttpStatus.UNAUTHORIZED)
    .send(
      buildProblemDetails({
        status: HttpStatus.UNAUTHORIZED,
        title: 'Unauthorized',
        detail: 'Valid Basic Auth credentials are required to access Bull Board.',
        code: ERROR_CODES.UNAUTHORIZED,
        instance: request.url,
        requestId,
      }),
    );
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

export interface BullBoardOptions {
  user: string;
  password: string;
  basePath: string;
  redisHost: string;
  redisPort: number;
  queuePrefix: string;
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

    // Registered before the Basic-Auth hook so unauthenticated credential-guessing traffic is
    // throttled first — the auth check itself must not become the rate-limited resource.
    await fastify.register(fastifyRateLimit, {
      max: BULL_BOARD_RATE_LIMIT_MAX,
      timeWindow: BULL_BOARD_RATE_LIMIT_WINDOW_MS,
      keyGenerator: (req) => req.ip,
      errorResponseBuilder: (req, context) => {
        const requestId = resolveRequestId(req.headers);
        return buildProblemDetails({
          status: HttpStatus.TOO_MANY_REQUESTS,
          title: 'Too Many Requests',
          detail: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
          code: ERROR_CODES.RATE_LIMITED,
          instance: req.url,
          requestId,
        });
      },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });

    fastify.addHook('onRequest', async (request, reply) => {
      const authHeader = request.headers['authorization'];
      if (!authHeader?.startsWith('Basic ')) {
        sendUnauthorized(request, reply);
        return;
      }
      const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString();
      const colonIdx = decoded.indexOf(':');
      const user = colonIdx === -1 ? decoded : decoded.slice(0, colonIdx);
      const password = colonIdx === -1 ? '' : decoded.slice(colonIdx + 1);
      // Both checks must run regardless of first result to stay constant-time.
      const userOk = safeEqual(user, opts.user);
      const passOk = safeEqual(password, opts.password);
      if (!userOk || !passOk) {
        sendUnauthorized(request, reply);
        return;
      }
    });

    await fastify.register(serverAdapter.registerPlugin(), {
      prefix: opts.basePath,
      logLevel: 'silent',
    });
  };
}
