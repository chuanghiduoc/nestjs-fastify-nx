import { Injectable, NestMiddleware } from '@nestjs/common';
import { generateId } from '@nestjs-fastify-nx/shared';
import type { IncomingMessage, ServerResponse } from 'http';

interface RequestWithIds extends IncomingMessage {
  correlationId?: string;
  requestId?: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithIds, res: ServerResponse, next: () => void): void {
    const correlationId = (req.headers['x-correlation-id'] as string) ?? `corr-${generateId()}`;
    const requestId = (req.headers['x-request-id'] as string) ?? `req-${generateId()}`;

    req.correlationId = correlationId;
    req.requestId = requestId;
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-request-id', requestId);

    next();
  }
}
