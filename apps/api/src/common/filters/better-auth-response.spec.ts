import { describe, expect, it } from 'vitest';
import { maskBetterAuthServerResponse } from './better-auth-response';

const context = {
  instance: '/api/auth/sign-in/email',
  requestId: 'request-1',
  correlationId: 'correlation-1',
};

describe('maskBetterAuthServerResponse', () => {
  it('replaces a resolved 5xx body without preserving sensitive headers', async () => {
    const response = new Response(
      JSON.stringify({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Invalid prisma.user.findUnique(): database.internal:5432',
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'session=must-not-survive',
        },
      },
    );

    const masked = maskBetterAuthServerResponse(response, context);
    const serialized = await masked.text();

    expect(masked.status).toBe(500);
    expect(masked.headers.get('content-type')).toContain('application/problem+json');
    expect(masked.headers.has('set-cookie')).toBe(false);
    expect(serialized).toContain('"code":"internal_server_error"');
    expect(serialized).not.toContain('prisma');
    expect(serialized).not.toContain('database.internal');
  });

  it('leaves intentional 4xx auth responses untouched', () => {
    const response = new Response('{"code":"INVALID_PASSWORD"}', { status: 401 });

    expect(maskBetterAuthServerResponse(response, context)).toBe(response);
  });
});
