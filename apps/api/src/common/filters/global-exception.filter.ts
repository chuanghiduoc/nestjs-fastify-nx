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
import { ERROR_CODES, type ValidationErrorItemDto } from '@nestjs-fastify-nx/contracts';
import {
  buildProblemDetails,
  HTTP_STATUS_CODES,
  HTTP_STATUS_TITLES,
  PROBLEM_CONTENT_TYPE,
} from './problem-details.helper';

type RawWithIds = IncomingMessage & { requestId?: string };

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
    // Mercurius owns GraphQL error formatting — re-throw into the GraphQL envelope.
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

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return {
      status,
      title,
      detail: typeof body.message === 'string' ? body.message : 'Validation failed.',
      code: code === defaultCode ? ERROR_CODES.VALIDATION_FAILED : code,
      errors: body.errors,
    };
  }

  const detail = Array.isArray(body.message)
    ? body.message.join('; ')
    : typeof body.message === 'string'
      ? body.message
      : exception.message;

  return { status, title, detail, code };
}
