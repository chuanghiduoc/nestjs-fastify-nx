import { Injectable, NestMiddleware } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { ClsService } from 'nestjs-cls';
import type { IncomingMessage, ServerResponse } from 'http';
import { REQUEST_CONTEXT_KEYS, type RequestContextStore } from '@nestjs-fastify-nx/core';
import { activeTraceId, ensureRequestIds } from './request-id';

interface RequestWithIds extends IncomingMessage {
  correlationId?: string;
  requestId?: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService<RequestContextStore>) {}

  use(req: RequestWithIds, res: ServerResponse, next: () => void): void {
    // ClsModule's own middleware (mounted ahead of this one — see LoggingModule) already stamped
    // these onto the raw request via ensureRequestIds; going through the same accessor here keeps
    // the CLS store, the raw request and the response headers on one value even if that middleware
    // somehow did not run.
    const { requestId, correlationId } = ensureRequestIds(req, req.headers);
    if (this.cls.isActive()) {
      this.cls.set(REQUEST_CONTEXT_KEYS.requestId, requestId);
      this.cls.set(REQUEST_CONTEXT_KEYS.correlationId, correlationId);
    }

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
