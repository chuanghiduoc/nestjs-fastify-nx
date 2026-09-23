import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from './public.decorator';

export function requestOf<T extends FastifyRequest = FastifyRequest>(context: ExecutionContext): T {
  if (context.getType<GqlContextType>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req: T }>().req;
  }
  return context.switchToHttp().getRequest<T>();
}

export function isPublic(reflector: Reflector, context: ExecutionContext): boolean {
  return Boolean(
    reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]),
  );
}
