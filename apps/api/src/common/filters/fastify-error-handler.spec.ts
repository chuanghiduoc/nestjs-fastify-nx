/// <reference types="vitest/globals" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { applyFastifyErrorHandler } from './fastify-error-handler';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

function buildApp(): FastifyInstance {
  const app = Fastify();
  applyFastifyErrorHandler(app);
  return app;
}

describe('applyFastifyErrorHandler', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('emits RFC 9457 body with code + requestId for unknown errors', async () => {
    app.get('/boom', async () => {
      throw new Error('kaboom');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.headers['x-request-id']).toBeDefined();
    const body = res.json();
    expect(body.status).toBe(500);
    expect(body.code).toBe('internal_server_error');
    expect(body.title).toBe('Internal Server Error');
  });

  it('resolves status from FastifyError.statusCode (Nest-native shape)', async () => {
    app.get('/forbidden', async () => {
      const e = new Error('nope') as Error & { statusCode: number };
      e.statusCode = 403;
      throw e;
    });
    const res = await app.inject({ method: 'GET', url: '/forbidden' });
    expect(res.statusCode).toBe(403);
    expect(res.json().status).toBe(403);
  });

  it('resolves status from error.status (RFC 9457 shape) when statusCode absent', async () => {
    app.get('/rate', async () => {
      const e = new Error('limited') as Error & { status: number };
      e.status = 429;
      throw e;
    });
    const res = await app.inject({ method: 'GET', url: '/rate' });
    expect(res.statusCode).toBe(429);
  });

  it('passes through pre-shaped RFC 9457 errors without rebuilding body', async () => {
    const preShaped = {
      type: 'https://tools.ietf.org/html/rfc6585#section-4',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Rate limit exceeded. Try again in 60 seconds.',
      retryAfter: 60,
    };
    app.get('/limited', async () => {
      throw preShaped;
    });
    const res = await app.inject({ method: 'GET', url: '/limited' });
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.retryAfter).toBe(60);
    expect(body.type).toBe(preShaped.type);
    expect(body.title).toBe('Too Many Requests');
  });

  it('does NOT pass through partial problem-details (missing type)', async () => {
    app.get('/partial', async () => {
      throw { status: 418, title: 'I am a teapot' };
    });
    const res = await app.inject({ method: 'GET', url: '/partial' });
    // Without `type`, error gets rebuilt — `code` field is the marker.
    expect(res.json().code).toBeDefined();
  });

  it('does NOT pass through errors with out-of-range status', async () => {
    app.get('/bad-status', async () => {
      throw { type: 'about:blank', title: 'Weird', status: 200 };
    });
    const res = await app.inject({ method: 'GET', url: '/bad-status' });
    // 200 status → falls to INTERNAL_SERVER_ERROR rebuild path.
    expect(res.statusCode).toBe(500);
  });

  it('maps FST_ERR_CTP_BODY_TOO_LARGE to 413', async () => {
    app.post('/json', { bodyLimit: 10 }, async () => 'ok');
    const res = await app.inject({
      method: 'POST',
      url: '/json',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: 'x'.repeat(100) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('payload_too_large');
  });

  it('echoes incoming x-request-id header on response', async () => {
    app.get('/echo', async () => {
      throw new Error('x');
    });
    const res = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-request-id': 'caller-supplied-id-123' },
    });
    expect(res.headers['x-request-id']).toBe('caller-supplied-id-123');
  });

  it('masks 5xx detail in production but keeps it in non-production', async () => {
    app.get('/leak', async () => {
      throw new Error('internal db connection string leak');
    });

    const devRes = await app.inject({ method: 'GET', url: '/leak' });
    expect(devRes.json().detail).toBe('internal db connection string leak');

    const prev = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const prodRes = await app.inject({ method: 'GET', url: '/leak' });
      expect(prodRes.json().detail).toBe('Internal Server Error');
      expect(prodRes.json().detail).not.toContain('leak');
    } finally {
      process.env['NODE_ENV'] = prev;
    }
  });

  it('does not overwrite a hijacked reply', async () => {
    app.get('/hijack', async (_req, reply) => {
      reply.hijack();
      reply.raw.statusCode = 204;
      reply.raw.end();
    });
    const res = await app.inject({ method: 'GET', url: '/hijack' });
    expect(res.statusCode).toBe(204);
  });
});
