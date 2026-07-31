import { HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { sanitizeUrlForLogging } from '@nestjs-fastify-nx/shared';
import { ensureRequestIds, sanitizeClientId, type RequestIdCarrier } from '../logging/request-id';
import {
  buildProblemDetails,
  statusCode,
  statusTitle,
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

export function applyFastifyProblemDetailsHook(fastify: FastifyInstance): void {
  fastify.addHook('onSend', (request, reply, payload, done) => {
    const safeUrl = sanitizeUrlForLogging(request.url);
    // Prefer what is already on the request, then what an earlier layer buffered onto the reply,
    // and only mint a fresh pair as a last resort — ensureRequestIds enforces the resolve-once rule.
    const raw = request.raw as RequestIdCarrier;
    raw.requestId ??= sanitizeClientId(reply.getHeader('x-request-id'));
    raw.correlationId ??= sanitizeClientId(reply.getHeader('x-correlation-id'));
    const { requestId, correlationId } = ensureRequestIds(raw, request.headers);
    if (!reply.getHeader('x-request-id')) reply.header('x-request-id', requestId);
    if (!reply.getHeader('x-correlation-id')) reply.header('x-correlation-id', correlationId);

    if (reply.statusCode < 400) {
      done();
      return;
    }

    const source = parseSerializedError(payload);
    const status = reply.statusCode;
    reply.header('content-type', PROBLEM_CONTENT_TYPE);

    if (isProblemDetailsShape(source) && source.status === status) {
      const title = status >= 500 ? statusTitle(status) : source.title;
      const detail = status >= 500 ? title : source.detail;
      const normalized = buildProblemDetails({
        status,
        title,
        detail,
        code: status < 500 && typeof source.code === 'string' ? source.code : statusCode(status),
        instance: sanitizeUrlForLogging(
          typeof source.instance === 'string' ? source.instance : request.url,
        ),
        requestId,
        errors: status < 500 && Array.isArray(source.errors) ? source.errors : undefined,
        checks:
          status >= 500 && source.checks && typeof source.checks === 'object'
            ? source.checks
            : undefined,
      });
      const response =
        status < 500 && typeof source.retryAfter === 'number'
          ? { ...normalized, retryAfter: source.retryAfter }
          : normalized;
      done(null, JSON.stringify(response));
      return;
    }

    const rawCode = typeof source?.['code'] === 'string' ? source['code'] : undefined;
    const code =
      status < 500 && rawCode && !rawCode.startsWith('FST_')
        ? rawCode
        : resolveFastifyCode({ code: rawCode, statusCode: status } as FastifyError, status);
    const title =
      (typeof source?.['title'] === 'string' && source['title']) ||
      (typeof source?.['error'] === 'string' && source['error']) ||
      statusTitle(status) ||
      'Error';
    const rawDetail =
      (typeof source?.['detail'] === 'string' && source['detail']) ||
      (typeof source?.['message'] === 'string' && source['message']) ||
      title;
    // Unshaped Fastify 4xx errors are library/parser output, not an allowlisted application
    // Problem Details body. Do not reflect their free-form message either.
    const detail =
      status >= 500
        ? title
        : source?.['type'] && typeof source['type'] === 'string'
          ? rawDetail
          : title;

    if (status >= 500) {
      const error = Object.assign(new Error(rawDetail), { response: source });
      logger.error({ err: error, url: safeUrl }, 'Unnormalized Fastify 5xx response');
      Sentry.captureException(error, { tags: { requestId, correlationId } });
    }

    done(
      null,
      JSON.stringify(
        buildProblemDetails({
          status,
          title,
          detail,
          code,
          instance: safeUrl,
          requestId,
        }),
      ),
    );
  });
}

function parseSerializedError(payload: unknown): Record<string, unknown> | undefined {
  const serialized =
    typeof payload === 'string'
      ? payload
      : Buffer.isBuffer(payload)
        ? payload.toString('utf8')
        : undefined;
  if (!serialized) return undefined;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

interface ProblemDetailsLike {
  status: number;
  title: string;
  type: string;
  detail?: string;
  code?: string;
  instance?: string;
  errors?: Parameters<typeof buildProblemDetails>[0]['errors'];
  checks?: Parameters<typeof buildProblemDetails>[0]['checks'];
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

export function resolveFastifyStatus(error: FastifyError): number {
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

export function resolveFastifyCode(error: FastifyError, status: number): string {
  if (error.code && FASTIFY_CODE_TO_ERROR_CODE[error.code]) {
    return FASTIFY_CODE_TO_ERROR_CODE[error.code];
  }
  return statusCode(status);
}
