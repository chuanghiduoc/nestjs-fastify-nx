/// <reference types="vitest/globals" />
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { applyFastifyProblemDetailsHook } from './fastify-error-handler';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

describe('applyFastifyProblemDetailsHook', () => {
  it('normalizes a Fastify parser error without registering another error handler', async () => {
    const app = Fastify();
    applyFastifyProblemDetailsHook(app);
    app.post('/json', { bodyLimit: 10 }, async () => 'ok');

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/json',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ data: 'x'.repeat(100) }),
      });

      expect(res.statusCode).toBe(413);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.json()).toMatchObject({ status: 413, code: 'payload_too_large' });
    } finally {
      await app.close();
    }
  });

  it('does not mistake an arbitrary numeric status field for Problem Details', async () => {
    const app = Fastify();
    applyFastifyProblemDetailsHook(app);
    app.get('/partial', async (_request, reply) =>
      reply
        .status(400)
        .header('content-type', 'application/problem+json')
        .send({ status: 400, internal: 'must-not-pass-through' }),
    );

    try {
      const res = await app.inject('/partial');
      expect(res.json()).toMatchObject({ status: 400, code: 'bad_request', title: 'Bad Request' });
      expect(res.json()).not.toHaveProperty('internal');
      expect(res.headers['x-request-id']).toBe(res.json().requestId);
      expect(res.headers['x-correlation-id']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('preserves safe extensions on a complete Problem Details body', async () => {
    const app = Fastify();
    applyFastifyProblemDetailsHook(app);
    app.get('/limited', async (_request, reply) =>
      reply.status(429).header('x-request-id', 'server-generated-id').send({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        detail: 'Retry later',
        retryAfter: 5,
      }),
    );

    try {
      const res = await app.inject('/limited');
      expect(res.json()).toMatchObject({
        status: 429,
        retryAfter: 5,
        requestId: 'server-generated-id',
      });
      expect(res.headers['x-request-id']).toBe('server-generated-id');
    } finally {
      await app.close();
    }
  });

  it('masks 5xx detail in production but keeps it outside production', async () => {
    const app = Fastify();
    applyFastifyProblemDetailsHook(app);
    app.get('/leak', async (_request, reply) =>
      reply.status(500).send({ error: 'Internal Server Error', message: 'db at 10.0.0.5 refused' }),
    );

    const prev = process.env['NODE_ENV'];
    try {
      const devRes = await app.inject('/leak');
      expect(devRes.json().detail).toBe('db at 10.0.0.5 refused');

      process.env['NODE_ENV'] = 'production';
      const prodRes = await app.inject('/leak');
      expect(prodRes.json().detail).not.toContain('10.0.0.5');
      expect(prodRes.json()).toMatchObject({ status: 500, code: 'internal_server_error' });
    } finally {
      process.env['NODE_ENV'] = prev;
      await app.close();
    }
  });

  it('masks a pre-shaped 5xx Problem Details body in production', async () => {
    const app = Fastify();
    applyFastifyProblemDetailsHook(app);
    app.get('/preshaped-5xx', async (_request, reply) =>
      reply.status(503).send({
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,
        detail: 'upstream postgres at 10.0.0.5 refused connection',
      }),
    );

    const prev = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const res = await app.inject('/preshaped-5xx');
      expect(res.statusCode).toBe(503);
      expect(res.json().detail).not.toContain('10.0.0.5');
    } finally {
      process.env['NODE_ENV'] = prev;
      await app.close();
    }
  });

  it('echoes a trusted inbound x-request-id onto the response', async () => {
    const app = Fastify();
    applyFastifyProblemDetailsHook(app);
    app.get('/echo', async (_request, reply) => reply.status(500).send({ message: 'x' }));

    process.env['TRUST_INBOUND_REQUEST_ID'] = 'true';
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/echo',
        headers: { 'x-request-id': 'caller-supplied-id-123' },
      });
      expect(res.headers['x-request-id']).toBe('caller-supplied-id-123');
      expect(res.json().requestId).toBe('caller-supplied-id-123');
    } finally {
      delete process.env['TRUST_INBOUND_REQUEST_ID'];
      await app.close();
    }
  });

  it('leaves a successful response untouched', async () => {
    const app = Fastify();
    applyFastifyProblemDetailsHook(app);
    app.get('/ok', async () => ({ hello: 'world' }));

    try {
      const res = await app.inject('/ok');
      expect(res.json()).toEqual({ hello: 'world' });
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['x-request-id']).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
