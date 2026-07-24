import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { FastifyRequest } from 'fastify';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedSession } from './better-auth.types';

type RequestWithUser = FastifyRequest & { user: AuthenticatedSession };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // WS messages are handled at the socket.io layer, not by this HTTP/GraphQL guard.
    if (context.getType() === 'ws') return true;

    // Mirror BetterAuthGuard: a @Public route never populates request.user, so RolesGuard must not
    // run (it would 403 on a missing user). @Public + @Roles is a misconfiguration, but fail sanely.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = this.getRequest(context);
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        messageKey: I18N_KEYS.errors.auth.insufficient_permissions,
        message: 'Insufficient permissions',
      });
    }

    return true;
  }

  private getRequest(context: ExecutionContext): RequestWithUser {
    if (context.getType<GqlContextType>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      return gqlCtx.getContext<{ req: RequestWithUser }>().req;
    }
    return context.switchToHttp().getRequest<RequestWithUser>();
  }
}
