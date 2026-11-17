import { afterEach, describe, expect, it } from 'vitest';
import { Injectable } from '@nestjs/common';
import { EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { EventBusService } from './event-bus.service';

const LISTENER_OPTIONS = { async: true, promisify: true, suppressErrors: false } as const;

function eventOf(eventType: string): DomainEvent {
  return {
    eventId: 'event-1',
    eventType,
    aggregateId: 'aggregate-1',
    occurredAt: new Date('2026-07-14T00:00:00.000Z'),
    payload: {},
  };
}

@Injectable()
class RecordingListeners {
  readonly received: string[] = [];

  @OnEvent('users.registered', LISTENER_OPTIONS)
  async onRegistered(event: DomainEvent): Promise<void> {
    this.received.push(`exact:${event.eventType}`);
  }

  @OnEvent('users.*', LISTENER_OPTIONS)
  async onUsersStream(event: DomainEvent): Promise<void> {
    this.received.push(`stream:${event.eventType}`);
  }

  @OnEvent('users.deleted', LISTENER_OPTIONS)
  async onDeleted(): Promise<void> {
    throw new Error('listener rejected');
  }
}

describe('EventBusService with the Nest event emitter', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
  });

  async function boot(): Promise<{ bus: EventBusService; listeners: RecordingListeners }> {
    moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' })],
      providers: [EventBusService, RecordingListeners],
    }).compile();
    await moduleRef.init();
    return { bus: moduleRef.get(EventBusService), listeners: moduleRef.get(RecordingListeners) };
  }

  it('runs the exact and the wildcard listeners of an event', async () => {
    const { bus, listeners } = await boot();

    await bus.publish(eventOf('users.registered'));

    expect([...listeners.received].sort()).toEqual([
      'exact:users.registered',
      'stream:users.registered',
    ]);
  });

  it('propagates the rejection of a decorated listener', async () => {
    const { bus, listeners } = await boot();

    await expect(bus.publish(eventOf('users.deleted'))).rejects.toThrow('listener rejected');
    expect(listeners.received).toEqual(['stream:users.deleted']);
  });

  it('reports an event type that no listener matches', async () => {
    const { bus } = await boot();

    await expect(bus.publish(eventOf('files.uploaded'))).rejects.toThrow('No listener registered');
  });
});
