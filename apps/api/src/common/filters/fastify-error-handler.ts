import { HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ClsServiceManager } from 'nestjs-cls';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import type { RequestContextStore } from '@nestjs-fastify-nx/core';
import { resolveRequestId } from '../logging/request-id';
import {
  buildProblemDetails,
  HTTP_STATUS_CODES,
  HTTP_STATUS_TITLES,
  PROBLEM_CONTENT_TYPE,
} from './problem-details.helper';

const FASTIFY_CODE_TO_ERROR_CODE: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: ERROR_CODES.BAD_REQUEST,
  FST_ERR_CTP_EMPTY_JSON_BODY: ERROR_CODES.BAD_REQUEST,
  FST_ERR_CTP_INVALID_MEDIA_TYPE: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: ERROR_CODES.BAD_REQUEST,
  FST_ERR_CTP_BODY_TOO_LARGE: ERROR_CODES.PAYLOAD_TOO_LARGE,
  FST_ERR_VALIDATION: ERROR_CODES.VALIDATION_FAILED,
};

const logger = new Logger('FastifyErrorHandler');

interface RawWithIds {
  requestId?: string;
}

export function applyFastifyErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // Hijacked replies (Better Auth) own their response — cannot send after hijack.
    if (reply.sent || reply.raw.headersSent) {
      return;
    }

    const status = resolveStatus(error);
    const code = resolveCode(error, status);
    const title = HTTP_STATUS_TITLES[status] ?? 'Error';
    // Mask 5xx detail in production — raw FST_ERR_*/driver messages can leak internals.
    const detail =
      status >= 500 && process.env['NODE_ENV'] === 'production' ? title : error.message || title;

    // raw.requestId is set by the middleware (or the rate-limit errorResponseBuilder) so the
    // header echoes the id already in the body; otherwise resolve it the same way. CLS is
    // preferred when active since it's the single source correlationId is seeded from —
    // this handler can run before ClsMiddleware for the earliest Fastify-level failures
    // (e.g. malformed requests), so `raw`/header fallbacks stay as a safety net.
    // Guard the lookup: this handler can fire on a raw Fastify scope where the
    // CLS service was never registered, so getClsService() may be undefined.
    const clsStore = ClsServiceManager.getClsService<RequestContextStore>()?.get();
    const requestId =
      clsStore?.requestId ||
      (request.raw as RawWithIds).requestId ||
      resolveRequestId(request.headers);
    const correlationId =
      clsStore?.correlationId || (request.headers['x-correlation-id'] as string) || requestId;

    if (status >= 500) {
      logger.error({ err: error, url: request.url }, 'Fastify-level exception');
      Sentry.captureException(error, { tags: { requestId, correlationId } });
    }

    if (!reply.getHeader('x-request-id')) {
      reply.header('x-request-id', requestId);
    }

    // Pass through pre-shaped RFC 9457 bodies (@fastify/rate-limit) — rebuilding
    // drops plugin-specific fields. A production 5xx still falls through to the
    // masked rebuild below so internal detail never leaks.
    const isProdServerError = status >= 500 && process.env['NODE_ENV'] === 'production';
    if (isProblemDetailsShape(error) && !isProdServerError) {
      void reply.status(status).header('content-type', PROBLEM_CONTENT_TYPE).send(error);
      return;
    }

    void reply
      .status(status)
      .header('content-type', PROBLEM_CONTENT_TYPE)
      .send(
        buildProblemDetails({
          status,
          title,
          detail,
          code,
          instance: request.url,
          requestId,
        }),
      );
  });
}

interface ProblemDetailsLike {
  status: number;
  title: string;
  type: string;
  detail?: string;
  retryAfter?: number;
}

function isProblemDetailsShape(error: unknown): error is ProblemDetailsLike {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  return (
    typeof e['status'] === 'number' &&
    e['status'] >= 400 &&
    e['status'] < 600 &&
    typeof e['title'] === 'string' &&
    typeof e['type'] === 'string'
  );
}

function resolveStatus(error: FastifyError): number {
  // Check both `status` (RFC 9457 / rate-limit shape) and `statusCode` (Fastify/Nest) to avoid masking 429 as 500.
  const candidates = [error.statusCode, (error as unknown as { status?: number }).status];
  for (const c of candidates) {
    if (typeof c === 'number' && c >= 400 && c < 600) return c;
  }
  if (error.code && FASTIFY_CODE_TO_ERROR_CODE[error.code]) {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return HttpStatus.PAYLOAD_TOO_LARGE;
    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return HttpStatus.UNSUPPORTED_MEDIA_TYPE;
    // Malformed JSON body, empty body, bad content-length, and schema-validation failures are all 400.
    return HttpStatus.BAD_REQUEST;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function resolveCode(error: FastifyError, status: number): string {
  if (error.code && FASTIFY_CODE_TO_ERROR_CODE[error.code]) {
    return FASTIFY_CODE_TO_ERROR_CODE[error.code];
  }
  return HTTP_STATUS_CODES[status] ?? ERROR_CODES.INTERNAL_SERVER_ERROR;
}
