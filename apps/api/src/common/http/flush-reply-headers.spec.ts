import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { flushBufferedReplyHeaders } from './flush-reply-headers';

function makeReply(buffered: Record<string, string | number | string[] | undefined>): {
  reply: FastifyReply;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const setHeader = vi.fn();
  const reply = {
    getHeaders: () => buffered,
    raw: { setHeader },
  } as unknown as FastifyReply;
  return { reply, setHeader };
}

describe('flushBufferedReplyHeaders', () => {
  it('copies every buffered header onto reply.raw', () => {
    const { reply, setHeader } = makeReply({
      'access-control-allow-origin': 'http://localhost:5173',
      'access-control-allow-credentials': 'true',
      'x-request-id': 'abc',
    });

    flushBufferedReplyHeaders(reply);

    expect(setHeader).toHaveBeenCalledWith('access-control-allow-origin', 'http://localhost:5173');
    expect(setHeader).toHaveBeenCalledWith('access-control-allow-credentials', 'true');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'abc');
    expect(setHeader).toHaveBeenCalledTimes(3);
  });

  it('skips undefined header values', () => {
    const { reply, setHeader } = makeReply({ 'x-present': 'yes', 'x-absent': undefined });

    flushBufferedReplyHeaders(reply);

    expect(setHeader).toHaveBeenCalledExactlyOnceWith('x-present', 'yes');
  });

  it('preserves array (multi) header values such as set-cookie', () => {
    const { reply, setHeader } = makeReply({ 'set-cookie': ['a=1', 'b=2'] });

    flushBufferedReplyHeaders(reply);

    expect(setHeader).toHaveBeenCalledWith('set-cookie', ['a=1', 'b=2']);
  });
});
