import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'nestjs-pino';
import { createManagedApiRedis } from './api-redis.factory';

function makeFastifyMock() {
  const hooks: Record<string, (() => Promise<void>)[]> = {};
  return {
    addHook: vi.fn((name: string, fn: () => Promise<void>) => {
      (hooks[name] ??= []).push(fn);
    }),
    hooks,
  } as unknown as FastifyInstance & { hooks: Record<string, (() => Promise<void>)[]> };
}

function makeLoggerMock() {
  return { warn: vi.fn() } as unknown as Logger;
}

describe('createManagedApiRedis', () => {
  it('logs errors under the given label', () => {
    const fastify = makeFastifyMock();
    const logger = makeLoggerMock();

    const client = createManagedApiRedis(fastify, logger, {
      config: { host: 'localhost', port: 6379 },
      db: 0,
      label: 'Idempotency',
    });

    const err = new Error('boom');
    client.emit('error', err);

    expect(logger.warn).toHaveBeenCalledWith({ err }, 'Idempotency Redis error');
    void client.disconnect();
  });

  it('registers an onClose hook that closes the client', async () => {
    const fastify = makeFastifyMock();
    const logger = makeLoggerMock();

    const client = createManagedApiRedis(fastify, logger, {
      config: { host: 'localhost', port: 6379 },
      db: 0,
      label: 'Rate-limit',
    });
    const disconnectSpy = vi.spyOn(client, 'disconnect').mockResolvedValue(undefined);
    vi.spyOn(client, 'quit').mockRejectedValue(new Error('already closed'));

    expect(fastify.addHook).toHaveBeenCalledWith('onClose', expect.any(Function));
    await fastify.hooks['onClose']?.[0]?.();

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});
