import { Injectable, NestMiddleware } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { IncomingMessage, ServerResponse } from 'http';
import { activeTraceId, resolveRequestId } from './request-id';

interface RequestWithIds extends IncomingMessage {
  correlationId?: string;
  requestId?: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithIds, res: ServerResponse, next: () => void): void {
    // X-Request-Id defaults to the trace id so header, logs and trace share one cross-service id.
    // correlationId spans a client journey, defaulting to this request's id when the client omits it.
    const requestId = resolveRequestId(req.headers);
    const correlationId = (req.headers['x-correlation-id'] as string) || requestId;

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
