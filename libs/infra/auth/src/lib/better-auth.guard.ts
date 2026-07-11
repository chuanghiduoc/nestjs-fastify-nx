import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import * as Sentry from '@sentry/nestjs';
import { ClsService } from 'nestjs-cls';
import { I18N_KEYS } from '@nestjs-fastify-nx/infra-i18n';
import { REQUEST_CONTEXT_KEYS, type RequestContextStore } from '@nestjs-fastify-nx/core';
import { BETTER_AUTH_INSTANCE } from './better-auth-instance.token';
import type { BetterAuthInstance } from './better-auth.config';
import type { AuthenticatedSession } from './better-auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class BetterAuthGuard implements CanActivate {
  constructor(
    @Inject(BETTER_AUTH_INSTANCE) private readonly auth: BetterAuthInstance,
    private readonly reflector: Reflector,
    private readonly cls: ClsService<RequestContextStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = this.getRequest(context);

    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers as Record<string, string | string[]>),
    });

    if (!session || !session.user || !session.session) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        messageKey: I18N_KEYS.errors.auth.session_missing,
        message: 'Session not found or expired',
      });
    }

    // Explicit expiry check closes the cache-hit race window where getSession() serves stale data
    // for a few ms after the session row was revoked — cheap because the value is already in memory.
    const expiresAt = session.session.expiresAt;
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        messageKey: I18N_KEYS.errors.auth.session_expired,
        message: 'Session expired',
      });
    }

    const user = session.user as unknown as {
      id: string;
      email: string;
      name: string;
      role: string;
      status: string;
    };

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        messageKey: I18N_KEYS.errors.auth.account_inactive,
        message: 'Account is not active',
      });
    }

    const authenticatedSession: AuthenticatedSession = {
      userId: user.id,
      email: user.email,
      name: user.name ?? '',
      role: user.role,
      status: user.status,
      sessionId: session.session.id,
      sessionToken: session.session.token,
    };

    (request as FastifyRequest & { user: AuthenticatedSession }).user = authenticatedSession;

    // userId isn't known until the session resolves here, so it's seeded into CLS (and
    // Sentry's scope) from the guard rather than the request-start middleware — both then
    // read back the same value for the rest of the request (logs, error tags).
    if (this.cls.isActive()) {
      this.cls.set(REQUEST_CONTEXT_KEYS.userId, user.id);
    }
    Sentry.setUser({ id: user.id });

    return true;
  }

  private getRequest(context: ExecutionContext): FastifyRequest {
    if (context.getType<GqlContextType>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      return gqlCtx.getContext<{ req: FastifyRequest }>().req;
    }
    return context.switchToHttp().getRequest<FastifyRequest>();
  }
}
