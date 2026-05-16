import { HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { generateId } from '@nestjs-fastify-nx/shared';
import {
  buildProblemDetails,
  HTTP_STATUS_CODES,
  HTTP_STATUS_TITLES,
  PROBLEM_CONTENT_TYPE,
} from './problem-details.helper';

// Fastify error codes that fire during parsing/validation phases — these
// short-circuit the request lifecycle BEFORE the NestJS GlobalExceptionFilter
// can run, so they would otherwise leak Fastify's default JSON error shape.
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
    // Routes that take over the response stream (e.g. the Better Auth handler
    // calls `reply.hijack()`) must surface their own error responses — Fastify
    // cannot send to a hijacked socket without throwing.
    if (reply.sent || reply.raw.headersSent) {
      return;
    }

    const status = resolveStatus(error);
    const code = resolveCode(error, status);
    const title = HTTP_STATUS_TITLES[status] ?? 'Error';
    const detail = error.message || title;

    if (status >= 500) {
      logger.error({ err: error, url: request.url }, 'Fastify-level exception');
      Sentry.captureException(error);
    }

    const requestId =
      (request.raw as RawWithIds).requestId ??
      (request.headers['x-request-id'] as string | undefined) ??
      `req-${generateId()}`;

    if (!reply.getHeader('x-request-id')) {
      reply.header('x-request-id', requestId);
    }

    // Pass-through for errors already shaped as RFC 9457 (e.g. @fastify/rate-limit's
    // errorResponseBuilder returns { type, title, status, detail, retryAfter }).
    // Rebuilding via buildProblemDetails here would drop plugin-specific fields.
    const preShaped = error as unknown as ProblemDetailsLike;
    if (typeof preShaped.status === 'number' && typeof preShaped.title === 'string') {
      void reply.status(status).header('content-type', PROBLEM_CONTENT_TYPE).send(preShaped);
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
  status?: number;
  title?: string;
  type?: string;
  detail?: string;
  retryAfter?: number;
}

function resolveStatus(error: FastifyError): number {
  // RFC 9457 problem-details schema uses `status`; Fastify/Nest native errors
  // use `statusCode`. @fastify/rate-limit's errorResponseBuilder returns the
  // former — fall through to 500 here would mask 429 as Internal Server Error.
  const candidates = [error.statusCode, (error as unknown as { status?: number }).status];
  for (const c of candidates) {
    if (typeof c === 'number' && c >= 400 && c < 600) return c;
  }
  if (error.code && FASTIFY_CODE_TO_ERROR_CODE[error.code]) {
    return error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
        ? HttpStatus.UNSUPPORTED_MEDIA_TYPE
        : error.code === 'FST_ERR_VALIDATION'
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.BAD_REQUEST;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function resolveCode(error: FastifyError, status: number): string {
  if (error.code && FASTIFY_CODE_TO_ERROR_CODE[error.code]) {
    return FASTIFY_CODE_TO_ERROR_CODE[error.code];
  }
  return HTTP_STATUS_CODES[status] ?? ERROR_CODES.INTERNAL_SERVER_ERROR;
}
