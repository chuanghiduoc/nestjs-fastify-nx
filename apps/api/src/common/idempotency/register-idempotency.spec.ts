import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import { registerIdempotency } from './register-idempotency';

// Minimal in-memory stand-in for the two ioredis commands the store uses. This is NOT a database
// mock (the repo's no-mock rule targets Prisma/Postgres integration tests) — it is a deterministic
// double for exercising the plugin's control flow without a Redis container in a unit spec.
class FakeRedis {
  private readonly store = new Map<string, { value: string; expireAt: number }>();

  async set(key: string, value: string, _px: 'PX', ttlMs: number, nx?: 'NX'): Promise<'OK' | null> {
    this.gc();
    if (nx === 'NX' && this.store.has(key)) return null;
    this.store.set(key, { value, expireAt: Date.now() + ttlMs });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.gc();
    return this.store.get(key)?.value ?? null;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async eval(_script: string, _numKeys: number, key: string, ...args: string[]): Promise<number> {
    this.gc();
    const current = this.store.get(key);
    if (!current) return 0;
    const record = JSON.parse(current.value) as { state: string; ownerToken?: string };
    if (record.state !== 'pending' || record.ownerToken !== args[0]) return 0;

    if (args.length >= 3) {
      this.store.set(key, { value: args[1], expireAt: Date.now() + Number(args[2]) });
      return 1;
    }
    return this.del(key);
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expireAt <= now) this.store.delete(key);
    }
  }
}

const KEY_HEADER = { 'idempotency-key': 'key-1', 'content-type': 'application/json' };

interface AppSetup {
  app: FastifyInstance;
  callCount: () => number;
  errors: string[];
}

async function buildApp(redis: Redis): Promise<AppSetup> {
  const errors: string[] = [];
  let calls = 0;
  const app = Fastify();

  app.post('/api/v1/echo', async (req) => {
    calls += 1;
    return { calls, echoed: req.body };
  });
  app.get('/api/v1/echo', async () => {
    calls += 1;
    return { calls };
  });
  app.post('/api/v1/fail', async (_req, reply) => {
    calls += 1;
    return reply.status(500).send({ calls, failed: true });
  });
  app.post('/api/v1/timeout', async (_req, reply) => {
    calls += 1;
    return reply.status(504).send({ calls, timeout: true });
  });
  // A 2xx that carries no body — the shape a DELETE endpoint returns.
  app.post('/api/v1/nocontent', async (_req, reply) => {
    calls += 1;
    return reply.status(204).send();
  });
  // A 2xx whose payload reaches onSend as a Buffer rather than a string.
  app.post('/api/v1/binary', async (_req, reply) => {
    calls += 1;
    return reply
      .status(200)
      .header('content-type', 'application/octet-stream')
      .send(Buffer.from('binary-payload'));
  });

  registerIdempotency(app, {
    redis,
    ttlSeconds: 3600,
    lockTtlSeconds: 60,
    onError: (message) => errors.push(message),
  });

  await app.ready();
  return { app, callCount: () => calls, errors };
}

describe('registerIdempotency', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new FakeRedis() as unknown as Redis;
  });

  it('replays the first response for a repeated key and runs the handler once', async () => {
    const { app, callCount } = await buildApp(redis);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.payload).toBe(first.payload);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers['x-request-id']).toMatch(/^[a-f0-9]{32}$/);
    expect(second.headers['x-correlation-id']).toBe(second.headers['x-request-id']);
    expect(callCount()).toBe(1);
  });

  // A 2xx with an empty body is a completed mutation. Gating completion on the payload being a
  // string sent it down the failure path instead, releasing the lock so a retry re-ran the very
  // side effect the key exists to protect.
  it('completes and replays a 2xx that has no body, running the handler once', async () => {
    const { app, callCount } = await buildApp(redis);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/nocontent',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/nocontent',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(callCount()).toBe(1);
  });

  it('keeps the key pending for a 2xx body it cannot replay, so a duplicate conflicts instead of re-running', async () => {
    const { app, callCount, errors } = await buildApp(redis);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/binary',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/binary',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });

    expect(first.statusCode).toBe(200);
    // 409, not a second execution: releasing the lock here would let the mutation run twice.
    expect(second.statusCode).toBe(409);
    expect(callCount()).toBe(1);
    expect(errors.some((e) => e.includes('cannot replay'))).toBe(true);
  });

  it('treats JSON objects with different key order as the same payload', async () => {
    const { app, callCount } = await buildApp(redis);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: KEY_HEADER,
      payload: { outer: { a: 1, b: 2 }, items: [{ x: 1, y: 2 }] },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: KEY_HEADER,
      payload: { items: [{ y: 2, x: 1 }], outer: { b: 2, a: 1 } },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(callCount()).toBe(1);
  });

  it('passes through requests without an Idempotency-Key', async () => {
    const { app, callCount } = await buildApp(redis);
    const headers = { 'content-type': 'application/json' };

    await app.inject({ method: 'POST', url: '/api/v1/echo', headers, payload: { a: 1 } });
    await app.inject({ method: 'POST', url: '/api/v1/echo', headers, payload: { a: 1 } });

    expect(callCount()).toBe(2);
  });

  it('scopes secure production session cookies independently for users behind the same IP', async () => {
    const { app, callCount } = await buildApp(redis);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: { ...KEY_HEADER, cookie: '__Secure-better-auth.session_token=user-a' },
      payload: { a: 1 },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: { ...KEY_HEADER, cookie: '__Secure-better-auth.session_token=user-b' },
      payload: { a: 1 },
    });

    expect(first.json().calls).toBe(1);
    expect(second.json().calls).toBe(2);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(callCount()).toBe(2);
  });

  it('keeps the lock on 504 because timed-out handler work may still be running', async () => {
    const { app, callCount } = await buildApp(redis);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/timeout',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/timeout',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });

    expect(first.statusCode).toBe(504);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('idempotency_key_conflict');
    expect(callCount()).toBe(1);
  });

  it('ignores safe methods even when a key is present', async () => {
    const { app, callCount } = await buildApp(redis);

    await app.inject({ method: 'GET', url: '/api/v1/echo', headers: KEY_HEADER });
    await app.inject({ method: 'GET', url: '/api/v1/echo', headers: KEY_HEADER });

    expect(callCount()).toBe(2);
  });

  it('rejects a key reused with a different payload (422 mismatch)', async () => {
    const { app } = await buildApp(redis);

    await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: KEY_HEADER,
      payload: { a: 2 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.json().code).toBe('idempotency_key_mismatch');
  });

  it('returns 409 while an identical request is still in flight', async () => {
    const errors: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = Fastify();
    app.post('/api/v1/slow', async () => {
      await gate;
      return { ok: true };
    });
    registerIdempotency(app, {
      redis,
      ttlSeconds: 3600,
      lockTtlSeconds: 60,
      onError: (message) => errors.push(message),
    });
    await app.ready();

    const inFlight = app.inject({
      method: 'POST',
      url: '/api/v1/slow',
      headers: KEY_HEADER,
      payload: {},
    });
    // Let the first request's preHandler acquire the lock before the second arrives.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/slow',
      headers: KEY_HEADER,
      payload: {},
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('idempotency_key_conflict');

    release();
    const done = await inFlight;
    expect(done.statusCode).toBe(200);
  });

  it('releases the lock on a non-2xx response so the client may retry', async () => {
    const { app, callCount } = await buildApp(redis);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/fail',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/fail',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });

    expect(first.statusCode).toBe(500);
    expect(second.statusCode).toBe(500);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(callCount()).toBe(2);
  });

  it('rejects an over-long key with 400', async () => {
    const { app } = await buildApp(redis);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: { 'idempotency-key': 'x'.repeat(256), 'content-type': 'application/json' },
      payload: { a: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('idempotency_key_invalid');
  });

  it('fails open when Redis errors, letting the write through', async () => {
    const throwingRedis = {
      set: async () => {
        throw new Error('redis down');
      },
      get: async () => null,
      del: async () => 0,
    } as unknown as Redis;
    const { app, callCount, errors } = await buildApp(throwingRedis);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: KEY_HEADER,
      payload: { a: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(callCount()).toBe(1);
    expect(errors.some((message) => message.includes('acquire failed'))).toBe(true);
  });
});
