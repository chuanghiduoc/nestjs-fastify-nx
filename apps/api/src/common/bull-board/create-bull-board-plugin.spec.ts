import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const queueInstances = vi.hoisted(
  () =>
    [] as Array<{
      close: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }>,
);

vi.mock('@bull-board/api', () => ({
  createBullBoard: vi.fn().mockReturnValue({}),
}));
vi.mock('@bull-board/api/bullMQAdapter', () => {
  function BullMQAdapter(q: unknown) {
    return { queue: q };
  }
  return { BullMQAdapter };
});
vi.mock('@bull-board/fastify', () => {
  function FastifyAdapter() {
    return {
      setBasePath: vi.fn(),
      registerPlugin: vi.fn().mockReturnValue(vi.fn()),
    };
  }
  return { FastifyAdapter };
});
vi.mock('bullmq', () => {
  function Queue(name: string) {
    const queue = {
      name,
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    queueInstances.push(queue);
    return queue;
  }
  return { Queue };
});

import { createBullBoardPlugin } from './create-bull-board-plugin';
import { createBullBoard } from '@bull-board/api';

const defaultOpts = {
  user: 'admin',
  password: 'secret',
  basePath: '/admin/queues',
  redisHost: 'localhost',
  redisPort: 6380,
  queuePrefix: 'bull',
};

function makeFastify() {
  return {
    addHook: vi.fn(),
    register: vi.fn().mockResolvedValue(undefined),
  } as unknown as FastifyInstance;
}

describe('createBullBoardPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueInstances.length = 0;
  });

  it('returns a function (Fastify plugin)', () => {
    const plugin = createBullBoardPlugin(defaultOpts);
    expect(typeof plugin).toBe('function');
  });

  it('calls createBullBoard with queue adapters when registered', async () => {
    const plugin = createBullBoardPlugin(defaultOpts);
    const fastify = makeFastify();
    await plugin(fastify);
    expect(createBullBoard).toHaveBeenCalledOnce();
  });

  it('registers onRequest hook for basic auth', async () => {
    const plugin = createBullBoardPlugin(defaultOpts);
    const fastify = makeFastify();
    await plugin(fastify);
    expect(vi.mocked(fastify.addHook)).toHaveBeenCalledWith('onRequest', expect.any(Function));
  });

  it('registers onClose hook to close queue connections', async () => {
    const plugin = createBullBoardPlugin(defaultOpts);
    const fastify = makeFastify();
    await plugin(fastify);
    expect(vi.mocked(fastify.addHook)).toHaveBeenCalledWith('onClose', expect.any(Function));
  });

  it('force-disconnects a queue when graceful close fails', async () => {
    const plugin = createBullBoardPlugin(defaultOpts);
    const fastify = makeFastify();
    await plugin(fastify);
    const [firstQueue, ...remainingQueues] = queueInstances;
    if (!firstQueue) throw new Error('no BullMQ queues created');
    firstQueue.close.mockRejectedValueOnce(new Error('close failed'));
    const hook = vi.mocked(fastify.addHook).mock.calls.find((call) => call[0] === 'onClose')?.[1];
    if (!hook) throw new Error('onClose hook not registered');

    await (hook as () => Promise<void>)();

    expect(firstQueue.disconnect).toHaveBeenCalledOnce();
    expect(remainingQueues.every((queue) => queue.disconnect.mock.calls.length === 0)).toBe(true);
  });

  function getOnRequestHook(fastify: FastifyInstance) {
    const calls = vi.mocked(fastify.addHook).mock.calls;
    const call = calls.find((c) => c[0] === 'onRequest');
    if (!call) throw new Error('onRequest hook not registered');
    return call[1] as (
      req: { headers: Record<string, string | undefined> },
      reply: {
        header: ReturnType<typeof vi.fn>;
        status: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
      },
    ) => Promise<void>;
  }

  it('rejects request without Authorization header with 401', async () => {
    const plugin = createBullBoardPlugin(defaultOpts);
    const fastify = makeFastify();
    await plugin(fastify);
    const hook = getOnRequestHook(fastify);
    const reply = { header: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
    await hook({ headers: {} }, reply);
    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it('rejects request with wrong credentials with 401', async () => {
    const plugin = createBullBoardPlugin(defaultOpts);
    const fastify = makeFastify();
    await plugin(fastify);
    const hook = getOnRequestHook(fastify);
    const reply = { header: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
    const wrongCreds = Buffer.from('admin:wrong').toString('base64');
    await hook({ headers: { authorization: `Basic ${wrongCreds}` } }, reply);
    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it('allows request with correct credentials (no 401)', async () => {
    const plugin = createBullBoardPlugin(defaultOpts);
    const fastify = makeFastify();
    await plugin(fastify);
    const hook = getOnRequestHook(fastify);
    const reply = { header: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
    const correctCreds = Buffer.from('admin:secret').toString('base64');
    await hook({ headers: { authorization: `Basic ${correctCreds}` } }, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('allows correct credentials when password contains colon', async () => {
    const opts = { ...defaultOpts, password: 'secret:with:colons' };
    const plugin = createBullBoardPlugin(opts);
    const fastify = makeFastify();
    await plugin(fastify);
    const hook = getOnRequestHook(fastify);
    const reply = { header: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
    const creds = Buffer.from('admin:secret:with:colons').toString('base64');
    await hook({ headers: { authorization: `Basic ${creds}` } }, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });
});
