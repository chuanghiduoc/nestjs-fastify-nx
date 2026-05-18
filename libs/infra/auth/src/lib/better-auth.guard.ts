import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import { BETTER_AUTH_INSTANCE } from './better-auth-instance.token';
import type { BetterAuthInstance } from './better-auth.config';
import type { AuthenticatedSession } from './better-auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class BetterAuthGuard implements CanActivate {
  constructor(
    @Inject(BETTER_AUTH_INSTANCE) private readonly auth: BetterAuthInstance,
    private readonly reflector: Reflector,
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
      throw new UnauthorizedException('Session not found or expired');
    }

    // Defence-in-depth: Better Auth rejects expired sessions in `getSession()`,
    // but the cookie cache can serve stale (encrypted) data for a few ms after
    // the session row was revoked. An explicit expiresAt check closes that
    // window — cheap because the value is already in memory.
    const expiresAt = session.session.expiresAt;
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired');
    }

    const user = session.user as unknown as {
      id: string;
      email: string;
      name: string;
      role: string;
      status: string;
    };

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
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
