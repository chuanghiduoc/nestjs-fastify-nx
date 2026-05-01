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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BusinessRuleException } from '@nestjs-fastify-nx/core';
import {
  ERROR_CODES,
  errorTypeUrl,
  type ValidationErrorItemDto,
} from '@nestjs-fastify-nx/contracts';

type RawWithIds = IncomingMessage & { requestId?: string };

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

interface NormalizedError {
  status: number;
  title: string;
  detail?: string;
  code: string;
  errors?: ValidationErrorItemDto[];
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // GraphQL responses are formatted by Mercurius — we only log/report and
    // re-throw so the error surfaces in the standard GraphQL error envelope.
    if (host.getType<GqlContextType>() === 'graphql') {
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      if (status >= 500) {
        this.logger.error({ err: exception }, 'Unhandled GraphQL exception');
        Sentry.captureException(exception);
      }
      throw exception;
    }

    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const raw = request.raw as RawWithIds;

    const normalized = normalizeException(exception);

    if (normalized.status >= 500) {
      this.logger.error({ err: exception, url: request.url }, 'Unhandled exception');
      Sentry.captureException(exception);
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
      .send({
        type: errorTypeUrl(normalized.code),
        title: normalized.title,
        status: normalized.status,
        detail: normalized.detail,
        instance: request.url,
        code: normalized.code,
        requestId: raw.requestId,
        timestamp: new Date().toISOString(),
        ...(normalized.errors ? { errors: normalized.errors } : {}),
      });
  }
}

interface HttpExceptionResponseObject {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  code?: string;
  title?: string;
  errors?: ValidationErrorItemDto[];
}

function normalizeException(exception: unknown): NormalizedError {
  if (exception instanceof BusinessRuleException) {
    const body = exception.getResponse() as HttpExceptionResponseObject;
    return {
      status: exception.getStatus(),
      title: body.title ?? 'Business rule violation',
      detail: typeof body.message === 'string' ? body.message : undefined,
      code: exception.code,
      errors: body.errors,
    };
  }

  if (!(exception instanceof HttpException)) {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      title: 'Internal Server Error',
      detail:
        process.env['NODE_ENV'] === 'production'
          ? 'An unexpected error occurred.'
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

  // Validation pipe surfaces { errors: ValidationErrorItemDto[] } — pass through.
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return {
      status,
      title,
      detail: typeof body.message === 'string' ? body.message : 'Validation failed.',
      code: code === defaultCode ? ERROR_CODES.VALIDATION_FAILED : code,
      errors: body.errors,
    };
  }

  // Built-in exceptions (NotFound, BadRequest, …) return { message, error, statusCode }.
  // class-validator default returns { message: string[] } — flatten to plain detail; the
  // custom validation pipe should be used for structured output.
  const detail = Array.isArray(body.message)
    ? body.message.join('; ')
    : typeof body.message === 'string'
      ? body.message
      : exception.message;

  return { status, title, detail, code };
}

const HTTP_STATUS_TITLES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Method Not Allowed',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported Media Type',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HttpStatus.GATEWAY_TIMEOUT]: 'Gateway Timeout',
};

const HTTP_STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ERROR_CODES.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.UNPROCESSABLE_ENTITY,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ERROR_CODES.INTERNAL_SERVER_ERROR,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
};
