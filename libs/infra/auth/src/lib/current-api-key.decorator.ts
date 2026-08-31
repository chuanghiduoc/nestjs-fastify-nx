import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedApiKey } from './api-key.types';

/**
 * The API key ApiKeyGuard verified for this request, or undefined when the caller used a session
 * cookie instead. A route reachable both ways reads this to learn which identity is acting.
 */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedApiKey | undefined => {
    const request =
      ctx.getType<GqlContextType>() === 'graphql'
        ? GqlExecutionContext.create(ctx).getContext<{ req: FastifyRequest }>().req
        : ctx.switchToHttp().getRequest<FastifyRequest>();
    return (request as FastifyRequest & { apiKey?: AuthenticatedApiKey }).apiKey;
  },
);
