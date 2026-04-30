import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { GqlContextType } from '@nestjs/graphql';
import type { IncomingMessage } from 'http';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { FastifyRequest } from 'fastify';

export interface StandardResponse<T> {
  data: T;
  meta: { requestId: string; timestamp: string };
}

type RawWithIds = IncomingMessage & { requestId?: string };

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, StandardResponse<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<StandardResponse<T> | T> {
    // Skip response wrapping for GraphQL (Mercurius handles formatting)
    if (context.getType<GqlContextType>() === 'graphql') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const raw = request.raw as RawWithIds;
    return next.handle().pipe(
      map((data) => ({
        data,
        meta: {
          requestId: raw.requestId ?? '',
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}
