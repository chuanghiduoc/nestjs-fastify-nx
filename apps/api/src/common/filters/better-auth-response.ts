import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { buildProblemDetails } from './problem-details.helper';

export interface BetterAuthErrorContext {
  instance?: string;
  requestId: string;
  correlationId: string;
}

/**
 * Better Auth owns its own Fetch/Node response lifecycle, so resolved 5xx responses never reach
 * Fastify's onSend hook or Nest's exception filter. Replace the complete response here; inspecting
 * or copying its error body would reintroduce adapter/driver messages.
 */
export function maskBetterAuthServerResponse(
  response: Response,
  context: BetterAuthErrorContext,
): Response {
  if (response.status < 500) return response;

  const body = JSON.stringify(
    buildProblemDetails({
      status: response.status,
      title: response.status === 503 ? 'Service Unavailable' : 'Internal Server Error',
      code:
        response.status === 503
          ? ERROR_CODES.SERVICE_UNAVAILABLE
          : ERROR_CODES.INTERNAL_SERVER_ERROR,
      instance: context.instance,
      requestId: context.requestId,
    }),
  );
  const headers = new Headers({
    'content-type': 'application/problem+json',
    'x-request-id': context.requestId,
    'x-correlation-id': context.correlationId,
  });
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);

  return new Response(body, { status: response.status, headers });
}
