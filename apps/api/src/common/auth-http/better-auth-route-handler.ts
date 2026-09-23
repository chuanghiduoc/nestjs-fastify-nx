import { HttpStatus } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { toNodeHandler } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BetterAuthInstance } from '@nestjs-fastify-nx/infra-auth';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { sanitizeUrlForLogging } from '@nestjs-fastify-nx/shared';
import { ensureRequestIds } from '../logging/request-id';
import { flushBufferedReplyHeaders } from '../http/flush-reply-headers';
import { buildProblemDetails } from '../filters/problem-details.helper';
import { maskBetterAuthServerResponse } from '../filters/better-auth-response';
import { RETRY_AFTER_AUTH_UNAVAILABLE_SECONDS } from './auth-rate-limits';

export interface BetterAuthRouteHandlerOptions {
  // reply.hijack() detaches the request from Fastify, so neither the Nest TimeoutInterceptor nor any
  // Fastify timeout bounds this handler. Watchdog it so a Better Auth handler that hangs without
  // throwing (e.g. an OAuth token exchange stuck on an unresponsive upstream) can't pin a connection
  // open forever. 0 (timeout disabled) skips the watchdog.
  readonly timeoutMs: number;
  readonly logger: Logger;
}

export type BetterAuthRouteHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function createBetterAuthRouteHandler(
  auth: BetterAuthInstance,
  options: BetterAuthRouteHandlerOptions,
): BetterAuthRouteHandler {
  const { timeoutMs, logger } = options;

  return async (req, reply) => {
    // Establish the IDs before hijacking the response lifecycle. ensureRequestIds reuses whatever
    // Nest's CLS middleware already stamped for this request, so the hijacked response and the log
    // lines around it never disagree.
    const { requestId, correlationId } = ensureRequestIds(req.raw, req.headers);
    reply.header('x-request-id', requestId);
    reply.header('x-correlation-id', correlationId);

    // Propagate Fastify's parsed body to req.raw so Better Auth's toNodeHandler can read it.
    if (req.body !== undefined && (req.raw as unknown as { body?: unknown }).body === undefined) {
      (req.raw as unknown as { body: unknown }).body = req.body;
    }

    // Preserve headers buffered by @fastify/cors (Access-Control-*) and the x-request-id/-correlation
    // headers above across the hijack — Better Auth writes straight to reply.raw and drops whatever is
    // still buffered. Shared with the e2e test app so the regression test exercises this exact path.
    flushBufferedReplyHeaders(reply);
    reply.hijack();

    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    // Better Auth can resolve an APIError as a 5xx Response instead of throwing. Wrap its Fetch
    // handler before the Node adapter writes anything so that path is masked too.
    const betterAuthHandler = toNodeHandler(async (request) =>
      maskBetterAuthServerResponse(await auth.handler(request), {
        instance: sanitizeUrlForLogging(req.url),
        requestId,
        correlationId,
      }),
    );
    const handlerPromise = betterAuthHandler(req.raw, reply.raw);
    // Node can't cancel the handler; if it settles AFTER the watchdog already responded, swallow the
    // result/error here so it never surfaces as an unhandled rejection.
    handlerPromise.catch((late: unknown) => {
      if (timedOut) {
        // The real failure only surfaces here (after the watchdog already sent 503), so report it to
        // Sentry too — otherwise a genuine hung-then-failed handler would be invisible beyond a warn.
        Sentry.captureException(late, { tags: { requestId, correlationId } });
        logger.warn(
          { err: late, requestId, correlationId, url: sanitizeUrlForLogging(req.url) },
          `Better Auth handler rejected after the ${timeoutMs}ms watchdog fired`,
        );
      }
    });

    try {
      if (timeoutMs > 0) {
        await Promise.race([
          handlerPromise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              reject(new Error('BETTER_AUTH_HANDLER_TIMEOUT'));
            }, timeoutMs);
            timer.unref();
          }),
        ]);
      } else {
        await handlerPromise;
      }
    } catch (err) {
      // After hijack(), Fastify's error handler won't run — close manually to prevent slowloris hang.
      Sentry.captureException(err, { tags: { requestId, correlationId } });
      logger.error(
        { err, requestId, correlationId, url: sanitizeUrlForLogging(req.url) },
        timedOut ? 'Better Auth handler timed out' : 'Better Auth handler threw unexpectedly',
      );
      if (!reply.raw.headersSent) {
        const status = timedOut ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR;
        const body = JSON.stringify(
          buildProblemDetails({
            status,
            title: timedOut ? 'Service Unavailable' : 'Internal Server Error',
            code: timedOut ? ERROR_CODES.SERVICE_UNAVAILABLE : ERROR_CODES.INTERNAL_SERVER_ERROR,
            instance: sanitizeUrlForLogging(req.url),
            requestId,
          }),
        );
        const headers: Record<string, string | number> = {
          'Content-Type': 'application/problem+json',
          'Content-Length': Buffer.byteLength(body),
          'X-Request-Id': requestId,
          'X-Correlation-Id': correlationId,
        };
        if (timedOut) headers['Retry-After'] = String(RETRY_AFTER_AUTH_UNAVAILABLE_SECONDS);
        reply.raw.writeHead(status, headers);
        reply.raw.end(body);
      } else if (!reply.raw.writableEnded) {
        // The delegated handler may have started a response before throwing. It is too late to
        // replace the status/body, but ending the stream avoids leaving a half-open connection.
        reply.raw.end();
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
