import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDevRequestLogger } from './dev-request-logger';

type Hook = (req: FastifyRequest, reply: FastifyReply, done: () => void) => void;

function registerHooks() {
  const hooks = new Map<string, Hook>();
  const fastify = {
    addHook: (name: string, fn: Hook) => hooks.set(name, fn),
  } as unknown as FastifyInstance;

  registerDevRequestLogger(fastify);

  const call = (name: string, req: Partial<FastifyRequest>, reply: Partial<FastifyReply> = {}) => {
    const done = vi.fn();
    hooks.get(name)?.(req as FastifyRequest, reply as FastifyReply, done);
    return done;
  };

  return { hooks, call };
}

describe('registerDevRequestLogger', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  const output = () => (log.mock.calls as unknown[][]).map((args) => String(args[0])).join('\n');

  it('registers the three request lifecycle hooks', () => {
    const { hooks } = registerHooks();
    expect([...hooks.keys()]).toEqual(['onRequest', 'preHandler', 'onResponse']);
  });

  // A hook that returns without calling `done` hangs every request, and no assertion on the
  // logged output would catch it — so check the chain continues on both the logged and skipped path.
  it.each(['onRequest', 'preHandler', 'onResponse'])('always completes the %s hook', (name) => {
    const { call } = registerHooks();
    expect(
      call(name, { url: '/api/v1/users', method: 'POST', body: { a: 1 } }, { statusCode: 200 }),
    ).toHaveBeenCalledOnce();
    expect(
      call(name, { url: '/metrics', method: 'GET' }, { statusCode: 200 }),
    ).toHaveBeenCalledOnce();
  });

  it('logs method and url for a normal request', () => {
    const { call } = registerHooks();
    call('onRequest', { url: '/api/v1/users', method: 'GET' });
    expect(output()).toContain('/api/v1/users');
    expect(output()).toContain('GET');
  });

  it('redacts sensitive query values in the logged url', () => {
    const { call } = registerHooks();
    call('onRequest', { url: '/api/v1/users?token=supersecret', method: 'GET' });
    expect(output()).not.toContain('supersecret');
  });

  it.each(['/api/v1/health/live', '/metrics', '/api/health'])('stays silent for %s', (url) => {
    const { call } = registerHooks();
    call('onRequest', { url, method: 'GET' });
    call('onResponse', { url, method: 'GET' }, { statusCode: 200 });
    expect(log).not.toHaveBeenCalled();
  });

  it('logs body field names but never their values', () => {
    const { call } = registerHooks();
    call('preHandler', { url: '/api/v1/users', method: 'POST', body: { email: 'a@b.c' } });
    expect(output()).toContain('email');
    expect(output()).not.toContain('a@b.c');
  });

  it('escapes control characters in body keys so they cannot inject ansi sequences', () => {
    const { call } = registerHooks();
    call('preHandler', { url: '/api/v1/users', method: 'POST', body: { '[31mred': 1 } });
    expect(output()).not.toContain('[31m');
    expect(output()).toContain('\\u001b[31mred');
  });

  it('truncates the key preview past ten fields', () => {
    const body = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, i]));
    const { call } = registerHooks();
    call('preHandler', { url: '/api/v1/users', method: 'POST', body });
    expect(output()).toContain('...+2');
  });

  it('skips the body hook for reads and for empty bodies', () => {
    const { call } = registerHooks();
    call('preHandler', { url: '/api/v1/users', method: 'GET', body: { a: 1 } });
    call('preHandler', { url: '/api/v1/users', method: 'POST', body: undefined });
    expect(log).not.toHaveBeenCalled();
  });

  it('reports a non-object body without inspecting it', () => {
    const { call } = registerHooks();
    call('preHandler', { url: '/api/v1/users', method: 'POST', body: 'raw-payload' });
    expect(output()).toContain('(non-object)');
    expect(output()).not.toContain('raw-payload');
  });

  it('reports an empty object body', () => {
    const { call } = registerHooks();
    call('preHandler', { url: '/api/v1/users', method: 'POST', body: {} });
    expect(output()).toContain('(empty)');
  });

  it.each([
    [200, '32'],
    [301, '36'],
    [404, '33'],
    [500, '31'],
  ])('colors status %i by severity', (statusCode, ansi) => {
    const { call } = registerHooks();
    call('onResponse', { url: '/api/v1/users', method: 'GET' }, { statusCode });
    expect(output()).toContain(`[${ansi}m${statusCode}`);
  });

  it('reports an unknown duration when the request was never timed', () => {
    const { call } = registerHooks();
    call('onResponse', { url: '/api/v1/users', method: 'GET' }, { statusCode: 200 });
    expect(output()).toContain('in ?ms');
  });

  it('measures duration when the request passed through onRequest', () => {
    const { call } = registerHooks();
    const req = { url: '/api/v1/users', method: 'GET' };
    call('onRequest', req);
    call('onResponse', req, { statusCode: 200 });
    expect(output()).toMatch(/in \d+ms/);
  });
});
