import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedSession } from './better-auth.types';

// Returns the session BetterAuthGuard attached to the request (works for both REST and GraphQL).
// Use on authenticated routes only — on a @Public route the guard does not populate req.user, so this
// resolves to undefined. Lives in infra-auth (not a feature module) so any scope:modules lib can share
// it without crossing a module boundary.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedSession => {
    const request =
      ctx.getType<GqlContextType>() === 'graphql'
        ? GqlExecutionContext.create(ctx).getContext<{ req: FastifyRequest }>().req
        : ctx.switchToHttp().getRequest<FastifyRequest>();
    return (request as FastifyRequest & { user: AuthenticatedSession }).user;
  },
);
