import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket messages are rate-limited at the socket.io layer (ws-auth.adapter), not here. As a
    // global APP_GUARD this also runs on @SubscribeMessage handlers; the base guard would read the
    // socket as an HTTP req/res and throw `res.header is not a function` on every message.
    if (context.getType() === 'ws') return true;
    return super.canActivate(context);
  }

  protected override getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>;
    res: Record<string, unknown>;
  } {
    if (context.getType<GqlContextType>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      const ctx = gqlCtx.getContext<{ req: FastifyRequest; reply: FastifyReply }>();
      return {
        req: ctx.req as unknown as Record<string, unknown>,
        res: ctx.reply as unknown as Record<string, unknown>,
      };
    }
    return super.getRequestResponse(context);
  }
}
