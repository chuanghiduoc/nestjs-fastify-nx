import { describe, expect, it, vi } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { EventBusService } from './event-bus.service';

const event: DomainEvent = {
  eventId: 'event-1',
  eventType: 'users.registered',
  aggregateId: 'user-1',
  occurredAt: new Date('2026-07-14T00:00:00.000Z'),
  payload: {},
};

describe('EventBusService', () => {
  it('resolves after registered listeners complete', async () => {
    const emitter = { emitAsync: vi.fn().mockResolvedValue([undefined]) };
    const bus = new EventBusService(emitter as unknown as EventEmitter2);

    await expect(bus.publish(event)).resolves.toBeUndefined();
    expect(emitter.emitAsync).toHaveBeenCalledWith(event.eventType, event);
  });

  it('rejects an event that has no registered listener', async () => {
    const emitter = { emitAsync: vi.fn().mockResolvedValue([]) };
    const bus = new EventBusService(emitter as unknown as EventEmitter2);

    await expect(bus.publish(event)).rejects.toThrow(
      'No listener registered for domain event "users.registered"',
    );
  });

  it('propagates listener failures', async () => {
    const emitter = { emitAsync: vi.fn().mockRejectedValue(new Error('listener failed')) };
    const bus = new EventBusService(emitter as unknown as EventEmitter2);

    await expect(bus.publish(event)).rejects.toThrow('listener failed');
  });
});
