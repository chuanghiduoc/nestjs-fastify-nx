import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { ROLES_KEY } from './roles.decorator';
import { isPublic, requestOf } from './request-context';
import type { AuthenticatedSession } from './better-auth.types';

type RequestWithUser = FastifyRequest & { user: AuthenticatedSession };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // The socket middleware establishes data.user; role metadata is still enforced here so
    // @Roles() can never silently become a no-op on a message handler.
    // Mirror BetterAuthGuard: a @Public route never populates request.user, so RolesGuard must not
    // run (it would 403 on a missing user). @Public + @Roles is a misconfiguration, but fail sanely.
    if (isPublic(this.reflector, context)) return true;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const user =
      context.getType() === 'ws'
        ? context.switchToWs().getClient<{ data?: { user?: AuthenticatedSession } }>().data?.user
        : requestOf<RequestWithUser>(context).user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        messageKey: I18N_KEYS.errors.auth.insufficient_permissions,
        message: 'Insufficient permissions',
      });
    }

    return true;
  }
}
