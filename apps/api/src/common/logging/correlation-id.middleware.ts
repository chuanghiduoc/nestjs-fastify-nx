import { Injectable, NestMiddleware } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { ClsService } from 'nestjs-cls';
import type { IncomingMessage, ServerResponse } from 'http';
import { REQUEST_CONTEXT_KEYS, type RequestContextStore } from '@nestjs-fastify-nx/core';
import { activeTraceId, resolveRequestId } from './request-id';

interface RequestWithIds extends IncomingMessage {
  correlationId?: string;
  requestId?: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService<RequestContextStore>) {}

  use(req: RequestWithIds, res: ServerResponse, next: () => void): void {
    // ClsModule's own middleware (mounted ahead of this one — see LoggingModule) already
    // resolved these onto the CLS store; the direct-resolve fallback only guards against a
    // CLS context somehow not being active (defensive, should not happen in production).
    const requestId = this.cls.get(REQUEST_CONTEXT_KEYS.requestId) ?? resolveRequestId(req.headers);
    const correlationId =
      this.cls.get(REQUEST_CONTEXT_KEYS.correlationId) ??
      (req.headers['x-correlation-id'] as string) ??
      requestId;

    req.correlationId = correlationId;
    req.requestId = requestId;
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-request-id', requestId);

    const span = trace.getActiveSpan();
    if (span) {
      if (requestId !== activeTraceId()) span.setAttribute('request.id', requestId);
      if (correlationId !== requestId) span.setAttribute('correlation.id', correlationId);
    }

    next();
  }
}
