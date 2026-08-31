import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { FastifyRequest } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { REQUEST_CONTEXT_KEYS, type RequestContextStore } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import { hashApiKey, looksLikeApiKey, type Permission } from '@nestjs-fastify-nx/shared';
import { ALLOW_API_KEY_KEY } from './allow-api-key.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedApiKey } from './api-key.types';

type RequestWithApiKey = FastifyRequest & { apiKey?: AuthenticatedApiKey };

const BEARER_PREFIX = 'Bearer ';

// 401 rather than a DomainException: this runs in the transport layer alongside BetterAuthGuard,
// where the status is known and no domain rule was violated.
function invalidCredential(): UnauthorizedException {
  return new UnauthorizedException({
    code: ERROR_CODES.API_KEY_INVALID_CREDENTIAL,
    messageKey: I18N_KEYS.errors.api_keys.invalid_credential,
    message: 'API key is missing, revoked, or expired',
  });
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContextStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === 'ws') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = this.getRequest(context);
    const presented = this.extractKey(request);
    if (!presented) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_API_KEY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Refusing before the lookup keeps a key presented to a session-only route from being
    // confirmed or denied by timing, and stops it reaching a handler that expects a user.
    if (!allowed) throw invalidCredential();

    const row = await this.prisma.db.apiKey.findUnique({
      where: { keyHash: hashApiKey(presented) },
      select: {
        id: true,
        organizationId: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!row || row.revokedAt !== null) throw invalidCredential();
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      throw invalidCredential();
    }

    request.apiKey = {
      apiKeyId: row.id,
      organizationId: row.organizationId,
      scopes: row.scopes as Permission[],
    };

    if (this.cls.isActive()) {
      this.cls.set(REQUEST_CONTEXT_KEYS.organizationId, row.organizationId);
    }

    this.touchLastUsed(row.id);

    return true;
  }

  // Fire-and-forget: last-used is telemetry, and awaiting it would put a write on the hot path of
  // every machine request. A failure must never fail the request it is describing.
  private touchLastUsed(id: string): void {
    void this.prisma.db.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => {
        this.logger.warn({ err, apiKeyId: id }, 'Failed to record API key last-used timestamp');
      });
  }

  private extractKey(request: FastifyRequest): string | null {
    const header = request.headers['x-api-key'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    if (fromHeader && looksLikeApiKey(fromHeader)) return fromHeader;

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith(BEARER_PREFIX)) return null;

    const candidate = authorization.slice(BEARER_PREFIX.length).trim();
    return looksLikeApiKey(candidate) ? candidate : null;
  }

  private getRequest(context: ExecutionContext): RequestWithApiKey {
    if (context.getType<GqlContextType>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext<{ req: RequestWithApiKey }>().req;
    }
    return context.switchToHttp().getRequest<RequestWithApiKey>();
  }
}
