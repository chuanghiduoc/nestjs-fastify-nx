import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutboxPublisher } from './outbox-publisher.service';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { DomainEvent } from '@nestjs-fastify-nx/core';

class FakeOutboxEventDelegate {
  readonly created: Array<Record<string, unknown>> = [];
  readonly createMany = vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
    this.created.push(...data);
    return { count: data.length };
  });
}

function buildPrisma(delegate: FakeOutboxEventDelegate): PrismaService {
  return {
    db: { outboxEvent: delegate },
  } as unknown as PrismaService;
}

function buildEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: 'evt-1',
    eventType: 'users.registered',
    aggregateId: 'user-1',
    occurredAt: new Date('2026-04-28T00:00:00.000Z'),
    payload: { email: 'a@b.c' },
    ...overrides,
  };
}

describe('OutboxPublisher', () => {
  let outbox: FakeOutboxEventDelegate;
  let publisher: OutboxPublisher;

  beforeEach(() => {
    outbox = new FakeOutboxEventDelegate();
    publisher = new OutboxPublisher(buildPrisma(outbox));
  });

  it('persists a single event with type, aggregate id and serialized payload', async () => {
    await publisher.publish(buildEvent());

    expect(outbox.createMany).toHaveBeenCalledOnce();
    expect(outbox.created).toHaveLength(1);
    const [row] = outbox.created;
    // Application-stamped UUIDv7 — verify shape, not the random value.
    expect(row['id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(row).toMatchObject({
      eventType: 'users.registered',
      aggregateId: 'user-1',
      payload: {
        eventId: 'evt-1',
        occurredAt: '2026-04-28T00:00:00.000Z',
        payload: { email: 'a@b.c' },
      },
    });
  });

  it('persists multiple events in a single createMany call', async () => {
    await publisher.publishAll([
      buildEvent({ eventId: 'evt-1', aggregateId: 'user-1' }),
      buildEvent({
        eventId: 'evt-2',
        eventType: 'users.logged_in',
        aggregateId: 'user-2',
        payload: { ip: '1.1.1.1' },
      }),
    ]);

    expect(outbox.createMany).toHaveBeenCalledOnce();
    expect(outbox.created).toHaveLength(2);
    expect(outbox.created[1]).toMatchObject({
      eventType: 'users.logged_in',
      aggregateId: 'user-2',
      payload: { eventId: 'evt-2', payload: { ip: '1.1.1.1' } },
    });
  });

  it('is a no-op when called with an empty event array', async () => {
    await publisher.publishAll([]);
    expect(outbox.createMany).not.toHaveBeenCalled();
  });

  it('propagates persistence failures so the surrounding transaction can roll back', async () => {
    outbox.createMany.mockRejectedValueOnce(new Error('unique violation'));
    await expect(publisher.publish(buildEvent())).rejects.toThrow('unique violation');
  });
});
