import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { requestOf } from './request-context';
import type { AuthenticatedApiKey } from './api-key.types';

type RequestWithApiKey = FastifyRequest & { apiKey?: AuthenticatedApiKey };

/**
 * The API key ApiKeyGuard verified for this request, or undefined when the caller used a session
 * cookie instead. A route reachable both ways reads this to learn which identity is acting.
 */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedApiKey | undefined =>
    requestOf<RequestWithApiKey>(ctx).apiKey,
);
