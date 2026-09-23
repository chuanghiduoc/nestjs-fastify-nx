import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { requestOf } from './request-context';
import type { AuthenticatedSession } from './better-auth.types';

type RequestWithUser = FastifyRequest & { user: AuthenticatedSession };

// Returns the session BetterAuthGuard attached to the request (works for both REST and GraphQL).
// Use on authenticated routes only — on a @Public route the guard does not populate req.user, so this
// resolves to undefined. Lives in infra-auth (not a feature module) so any scope:modules lib can share
// it without crossing a module boundary.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedSession =>
    requestOf<RequestWithUser>(ctx).user,
);
