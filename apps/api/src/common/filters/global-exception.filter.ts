import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GqlContextType } from '@nestjs/graphql';
import * as Sentry from '@sentry/nestjs';
import type { IncomingMessage } from 'http';
import type { FastifyReply, FastifyRequest } from 'fastify';

type RawWithIds = IncomingMessage & { requestId?: string };

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType<GqlContextType>() === 'graphql') {
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;

      if (status >= 500) {
        this.logger.error({ err: exception }, 'Unhandled GraphQL exception');
        Sentry.captureException(exception);
      }
      // Re-throw so Mercurius formats the GraphQL error response
      throw exception;
    }

    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const raw = request.raw as RawWithIds;

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    if (status >= 500) {
      this.logger.error({ err: exception, url: request.url }, 'Unhandled exception');
      Sentry.captureException(exception);
    } else if (status === 401 || status === 403) {
      this.logger.warn({ statusCode: status, url: request.url }, 'Auth rejected request');
    }

    reply.status(status).send({
      statusCode: status,
      message,
      requestId: raw.requestId ?? undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
