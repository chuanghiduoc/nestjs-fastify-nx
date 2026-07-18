import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GqlContextType } from '@nestjs/graphql';
import * as Sentry from '@sentry/nestjs';
import type { IncomingMessage } from 'http';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { I18nService } from 'nestjs-i18n';
import { ClsService } from 'nestjs-cls';
import {
  BusinessRuleException,
  REQUEST_CONTEXT_KEYS,
  type RequestContextStore,
} from '@nestjs-fastify-nx/core';
import { ERROR_CODES, type ValidationErrorItemDto } from '@nestjs-fastify-nx/contracts';
import {
  I18N_KEYS,
  resolveRequestLocale,
  translateOrFallback,
} from '@nestjs-fastify-nx/infra-i18n';
import {
  buildProblemDetails,
  HTTP_STATUS_CODES,
  HTTP_STATUS_TITLES,
  PROBLEM_CONTENT_TYPE,
} from './problem-details.helper';
import { resolveFastifyCode, resolveFastifyStatus } from './fastify-error-handler';

type RawWithIds = IncomingMessage & { requestId?: string; correlationId?: string };

interface NormalizedError {
  status: number;
  title: string;
  detail?: string;
  code: string;
  args?: Record<string, unknown>;
  errors?: ValidationErrorItemDto[];
}

// Maps the HTTP status → i18n key used when a NestJS built-in exception ships only a raw English `message`.
const HTTP_STATUS_TO_I18N_KEY: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: I18N_KEYS.common.bad_request,
  [HttpStatus.UNAUTHORIZED]: I18N_KEYS.common.unauthorized,
  [HttpStatus.FORBIDDEN]: I18N_KEYS.common.forbidden,
  [HttpStatus.NOT_FOUND]: I18N_KEYS.common.not_found,
  [HttpStatus.CONFLICT]: I18N_KEYS.common.conflict,
  [HttpStatus.PAYLOAD_TOO_LARGE]: I18N_KEYS.common.payload_too_large,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: I18N_KEYS.common.unsupported_media_type,
  [HttpStatus.UNPROCESSABLE_ENTITY]: I18N_KEYS.common.unprocessable_entity,
  [HttpStatus.TOO_MANY_REQUESTS]: I18N_KEYS.common.too_many_requests,
  [HttpStatus.INTERNAL_SERVER_ERROR]: I18N_KEYS.common.internal_server_error,
  [HttpStatus.GATEWAY_TIMEOUT]: I18N_KEYS.common.request_timeout,
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(
    private readonly i18n: I18nService,
    private readonly cls: ClsService<RequestContextStore>,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    // Mercurius owns GraphQL error formatting — re-throw into the GraphQL envelope.
    if (host.getType<GqlContextType>() === 'graphql') {
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      if (status >= 500) {
        this.logger.error({ err: exception }, 'Unhandled GraphQL exception');
        const requestId = this.cls.get(REQUEST_CONTEXT_KEYS.requestId);
        const correlationId = this.cls.get(REQUEST_CONTEXT_KEYS.correlationId);
        Sentry.captureException(exception, { tags: { requestId, correlationId } });
      }
      throw exception;
    }

    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const raw = request.raw as RawWithIds;
    const lang = resolveRequestLocale(request);

    const normalized = normalizeException(exception);
    await this.translateNormalized(normalized, lang);

    if (normalized.status >= 500) {
      this.logger.error({ err: exception, url: request.url }, 'Unhandled exception');
      Sentry.captureException(exception, {
        tags: { requestId: raw.requestId, correlationId: raw.correlationId },
      });
    } else if (
      normalized.status === HttpStatus.UNAUTHORIZED ||
      normalized.status === HttpStatus.FORBIDDEN
    ) {
      this.logger.warn(
        { statusCode: normalized.status, url: request.url, code: normalized.code },
        'Auth rejected request',
      );
    }

    reply
      .status(normalized.status)
      .header('content-type', PROBLEM_CONTENT_TYPE)
      .send(
        buildProblemDetails({
          status: normalized.status,
          title: normalized.title,
          detail: normalized.detail,
          code: normalized.code,
          instance: request.url,
          requestId: raw.requestId,
          errors: normalized.errors,
        }),
      );
  }

  // Mutates the normalized payload in place — title, detail, and per-violation messages all get the locale-resolved text. The original key is kept on errors[].messageKey for client persistence.
  private async translateNormalized(normalized: NormalizedError, lang: string): Promise<void> {
    normalized.title = await this.maybeTranslate(normalized.title, lang, normalized.args);
    if (normalized.detail) {
      normalized.detail = await this.maybeTranslate(normalized.detail, lang, normalized.args);
    } else {
      const fallbackKey = HTTP_STATUS_TO_I18N_KEY[normalized.status];
      if (fallbackKey) {
        normalized.detail = await translateOrFallback(this.i18n, fallbackKey, { lang });
      }
    }

    if (normalized.errors) {
      for (const item of normalized.errors) {
        if (item.messageKey) {
          const translated = await translateOrFallback(this.i18n, item.messageKey, {
            lang,
            args: { path: item.path, ...(item.constraint ?? {}) },
          });
          item.message = translated;
        }
      }
    }
  }

  // Treats any dotted string as a candidate i18n key; on miss the original literal flows through unchanged.
  private async maybeTranslate(
    value: string,
    lang: string,
    args?: Record<string, unknown>,
  ): Promise<string> {
    if (!value.includes('.')) return value;
    return translateOrFallback(this.i18n, value, { lang, args });
  }
}

interface HttpExceptionResponseObject {
  message?: string | string[];
  error?: string;
  code?: string;
  title?: string;
  messageKey?: string;
  // Interpolation arguments for `messageKey` — keys here fill `{placeholder}` slots in the translated string.
  args?: Record<string, unknown>;
  errors?: ValidationErrorItemDto[];
}

function normalizeException(exception: unknown): NormalizedError {
  if (exception instanceof BusinessRuleException) {
    const body = exception.getResponse() as HttpExceptionResponseObject;
    return {
      status: exception.getStatus(),
      // No fallback: the constructor always sets a title, so one here would be unreachable and
      // would imply a default that does not exist.
      title: body.title as string,
      detail: body.messageKey ?? (typeof body.message === 'string' ? body.message : undefined),
      code: exception.code,
      args: body.args,
      errors: body.errors,
    };
  }

  if (isFastifyLevelError(exception)) {
    const status = resolveFastifyStatus(exception);
    const problem = exception as FastifyError & {
      title?: string;
      detail?: string;
      code?: string;
    };
    const title = problem.title ?? HTTP_STATUS_TITLES[status] ?? 'Error';
    return {
      status,
      title,
      detail:
        status >= 500 && process.env['NODE_ENV'] === 'production'
          ? title
          : (problem.detail ?? problem.message ?? title),
      code:
        problem.code && !problem.code.startsWith('FST_')
          ? problem.code
          : resolveFastifyCode(exception, status),
    };
  }

  if (!(exception instanceof HttpException)) {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      title: I18N_KEYS.common.internal_server_error,
      detail:
        process.env['NODE_ENV'] === 'production'
          ? I18N_KEYS.common.internal_server_error
          : exception instanceof Error
            ? exception.message
            : 'Unknown error',
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    };
  }

  const status = exception.getStatus();
  const res = exception.getResponse();
  const defaultTitle = HTTP_STATUS_TITLES[status] ?? 'Error';
  const defaultCode = HTTP_STATUS_CODES[status] ?? ERROR_CODES.INTERNAL_SERVER_ERROR;

  if (typeof res === 'string') {
    return { status, title: defaultTitle, detail: res, code: defaultCode };
  }

  const body = res as HttpExceptionResponseObject;
  const title = typeof body.title === 'string' ? body.title : defaultTitle;
  const code = typeof body.code === 'string' ? body.code : defaultCode;
  // body.messageKey wins over message — domain code that throws with a key gets translated; raw NestJS exceptions fall back to their message string.
  const detailSource = body.messageKey ?? body.message;

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return {
      status,
      title,
      detail: typeof detailSource === 'string' ? detailSource : I18N_KEYS.validation.failed_detail,
      code: code === defaultCode ? ERROR_CODES.VALIDATION_FAILED : code,
      args: body.args,
      errors: body.errors,
    };
  }

  const detail = Array.isArray(detailSource)
    ? detailSource.join('; ')
    : typeof detailSource === 'string'
      ? detailSource
      : exception.message;

  return { status, title, detail, code, args: body.args };
}

function isFastifyLevelError(exception: unknown): exception is FastifyError {
  if (!exception || typeof exception !== 'object' || exception instanceof HttpException) {
    return false;
  }
  const candidate = exception as Record<string, unknown>;
  if (typeof candidate['code'] === 'string' && candidate['code'].startsWith('FST_')) return true;

  // Only accept an RFC 9457-like object here. Treating every object with a numeric `status` as a
  // client error can turn a driver/library exception into a 4xx and expose its raw message.
  return (
    typeof candidate['status'] === 'number' &&
    candidate['status'] >= 400 &&
    candidate['status'] < 600 &&
    typeof candidate['title'] === 'string' &&
    typeof candidate['type'] === 'string'
  );
}
