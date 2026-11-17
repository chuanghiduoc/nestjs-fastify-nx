import { describe, expect, it, vi } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainException } from '@nestjs-fastify-nx/core';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { EventBusService } from './event-bus.service';

const event: DomainEvent = {
  eventId: 'event-1',
  eventType: 'users.registered',
  aggregateId: 'user-1',
  occurredAt: new Date('2026-07-14T00:00:00.000Z'),
  payload: {},
};

type Listener = (event: DomainEvent) => unknown;

function busWith(listeners: Listener[]): {
  bus: EventBusService;
  emitter: { listeners: ReturnType<typeof vi.fn> };
} {
  const emitter = { listeners: vi.fn().mockReturnValue(listeners) };
  return { bus: new EventBusService(emitter as unknown as EventEmitter2), emitter };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('EventBusService', () => {
  it('resolves after every listener for the event type completes', async () => {
    const listener = vi.fn().mockResolvedValue(undefined);
    const { bus, emitter } = busWith([listener]);

    await expect(bus.publish(event)).resolves.toBeUndefined();
    expect(emitter.listeners).toHaveBeenCalledWith(event.eventType);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('rejects an event that has no registered listener as a retryable failure', async () => {
    const { bus } = busWith([]);

    const error = await bus.publish(event).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DomainException);
    expect((error as Error).message).toContain(
      'No listener registered for domain event "users.registered"',
    );
  });

  it('propagates a listener failure', async () => {
    const { bus } = busWith([vi.fn().mockRejectedValue(new Error('listener failed'))]);

    await expect(bus.publish(event)).rejects.toThrow('listener failed');
  });

  it('propagates a listener that throws synchronously', async () => {
    const { bus } = busWith([
      () => {
        throw new Error('sync failure');
      },
    ]);

    await expect(bus.publish(event)).rejects.toThrow('sync failure');
  });

  it('does not settle while another listener is still running after one rejects', async () => {
    const slow = deferred();
    const { bus } = busWith([
      vi.fn().mockRejectedValue(new Error('fast failure')),
      () => slow.promise,
    ]);
    let settled = false;

    const publish = bus.publish(event).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    slow.resolve();
    await expect(publish).rejects.toThrow('fast failure');
  });
});
