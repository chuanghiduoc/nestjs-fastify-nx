import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { FastifyRequest } from 'fastify';
import {
  DomainException,
  AUTHORIZATION_PORT,
  type AccessDecision,
  type AuthorizationPort,
} from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import {
  IS_PUBLIC_KEY,
  requireOrganizationId,
  type AuthenticatedApiKey,
  type AuthenticatedSession,
} from '@nestjs-fastify-nx/infra-auth';
import type { Permission } from '@nestjs-fastify-nx/shared';
import { REQUIRED_PERMISSIONS_KEY } from './require-permission.decorator';
import { decideWithoutOrganization, requiresMembership } from './access-policy';

type RequestWithUser = FastifyRequest & {
  user?: AuthenticatedSession;
  apiKey?: AuthenticatedApiKey;
};

function forbidden(permission: Permission): DomainException {
  return new DomainException({
    kind: 'forbidden',
    code: ERROR_CODES.FORBIDDEN,
    title: 'Insufficient permissions',
    messageKey: I18N_KEYS.errors.auth.insufficient_permissions,
    violations: [
      {
        path: 'permission',
        code: 'permission_denied',
        // The permission name is the caller's own request, not information about the resource,
        // so echoing it leaks nothing while making the failure actionable.
        message: `Missing permission "${permission}"`,
        messageKey: I18N_KEYS.errors.auth.insufficient_permissions,
      },
    ],
  });
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket frames are authorized at the socket.io layer; running here would read the socket
    // as an HTTP request (see the global-enhancer rule in CLAUDE.md).
    if (context.getType() === 'ws') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const decisions = await this.decide(this.getRequest(context), required);

    const deniedIndex = decisions.findIndex((decision) => !decision.allowed);
    if (deniedIndex >= 0) throw forbidden(required[deniedIndex]);

    return true;
  }

  private async decide(
    request: RequestWithUser,
    required: readonly Permission[],
  ): Promise<readonly AccessDecision[]> {
    const requests = required.map((permission) => ({ permission }));

    if (request.apiKey) {
      return this.authorization.checkMany(
        {
          type: 'api_key',
          apiKeyId: request.apiKey.apiKeyId,
          organizationId: request.apiKey.organizationId,
          scopes: request.apiKey.scopes,
        },
        requests,
      );
    }

    const user = request.user;
    if (!user) throw forbidden(required[0]);

    if (!user.organizationId && required.every((permission) => !requiresMembership(permission))) {
      return decideWithoutOrganization(required);
    }

    return this.authorization.checkMany(
      { type: 'user', userId: user.userId, organizationId: requireOrganizationId(user) },
      requests,
    );
  }

  private getRequest(context: ExecutionContext): RequestWithUser {
    if (context.getType<GqlContextType>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext<{ req: RequestWithUser }>().req;
    }
    return context.switchToHttp().getRequest<RequestWithUser>();
  }
}
