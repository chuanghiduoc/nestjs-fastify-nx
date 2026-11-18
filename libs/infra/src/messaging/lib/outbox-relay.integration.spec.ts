import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  createTestContainers,
  DatabaseCleaner,
  deployTestMigrations,
} from '@nestjs-fastify-nx/testing';
import type { TestContainers } from '@nestjs-fastify-nx/testing';
import { PrismaService } from '@nestjs-fastify-nx/infra/database';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { OutboxPublisher } from './outbox-publisher.service';
import { OutboxRelayService } from './outbox-relay.service';
import type { EventBusService } from './event-bus.service';

const EVENT_ID = '019dd1a5-9235-70db-8d57-540500000001';

describe('Outbox relay and publisher (integration)', () => {
  let containers: TestContainers;
  let prisma: PrismaService;
  let cleaner: DatabaseCleaner;
  let relay: OutboxRelayService;
  let publisher: OutboxPublisher;
  let bus: EventBusService & { publish: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    containers = await createTestContainers();
    const dbUrl = containers.postgres.getConnectionUri();
    process.env['DATABASE_URL'] = dbUrl;
    deployTestMigrations(dbUrl);

    prisma = new PrismaService();
    await prisma.onModuleInit();
    cleaner = new DatabaseCleaner(prisma.db);

    bus = { publish: vi.fn() } as unknown as typeof bus;
    relay = new OutboxRelayService(prisma, bus);
    publisher = new OutboxPublisher(prisma);
  }, 90_000);

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await containers?.teardown();
  });

  beforeEach(async () => {
    await cleaner.truncateAll();
    bus.publish.mockReset();
  });

  async function seedEvent(
    id: string,
    overrides: { attempts?: number; nextAttemptAt?: Date | null; eventId?: string } = {},
  ): Promise<void> {
    await prisma.db.outboxEvent.create({
      data: {
        id,
        organizationId: null,
        eventType: 'users.registered',
        aggregateId: '019dd1a5-9235-70db-8d57-540500000010',
        payload: {
          schemaVersion: 1,
          eventId: overrides.eventId ?? EVENT_ID,
          occurredAt: '2026-01-01T00:00:00.000Z',
          payload: { email: 'user@example.com' },
        },
        attempts: overrides.attempts ?? 0,
        nextAttemptAt: overrides.nextAttemptAt ?? null,
      },
    });
  }

  it('claims, publishes and marks a row processed', async () => {
    await seedEvent('019dd1a5-9235-70db-8d57-540500000011');

    expect(await relay.tick()).toBe(1);

    const row = await prisma.db.outboxEvent.findUniqueOrThrow({
      where: { id: '019dd1a5-9235-70db-8d57-540500000011' },
    });
    expect(row.processedAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(bus.publish).toHaveBeenCalledTimes(1);
  });

  it('does not claim a row until its backoff window expires', async () => {
    const id = '019dd1a5-9235-70db-8d57-540500000012';
    await seedEvent(id, { nextAttemptAt: new Date(Date.now() + 60_000) });

    expect(await relay.tick()).toBe(0);
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('does not claim a row that exhausted its attempts', async () => {
    const id = '019dd1a5-9235-70db-8d57-540500000013';
    await seedEvent(id, { attempts: 10 });

    expect(await relay.tick()).toBe(0);
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('stamps a future retry and records lastError when the listener fails', async () => {
    const id = '019dd1a5-9235-70db-8d57-540500000014';
    await seedEvent(id);
    bus.publish.mockRejectedValueOnce(new Error('listener exploded'));

    expect(await relay.tick()).toBe(0);

    const row = await prisma.db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('Error');
    expect(row.nextAttemptAt?.getTime() ?? 0).toBeGreaterThan(Date.now());
  });

  it('drains more pending rows than one batch in a single tick', async () => {
    const pendingIds = ['1', '2', '3', '4', '5'].map(
      (n) => `019dd1a5-9235-70db-8d57-54050000002${n}`,
    );
    for (const id of pendingIds) await seedEvent(id, { eventId: id });
    process.env['OUTBOX_BATCH_SIZE'] = '2';
    try {
      const smallBatchRelay = new OutboxRelayService(prisma, bus);

      expect(await smallBatchRelay.tick()).toBe(pendingIds.length);
    } finally {
      delete process.env['OUTBOX_BATCH_SIZE'];
    }

    expect(await prisma.db.outboxEvent.count({ where: { processedAt: null } })).toBe(0);
    expect(bus.publish).toHaveBeenCalledTimes(pendingIds.length);
  });

  it('writes the outbox row atomically with the caller transaction', async () => {
    const event: DomainEvent = {
      eventId: EVENT_ID,
      eventType: 'feature_flags.created',
      aggregateId: '019dd1a5-9235-70db-8d57-540500000015',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      organizationId: '019dd1a5-9235-70db-8d57-540500000016',
      payload: { userId: '019dd1a5-9235-70db-8d57-540500000017' },
    };

    await expect(
      prisma.transaction(async () => {
        await publisher.publish(event);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await prisma.db.outboxEvent.count()).toBe(0);
  });

  it('refuses an outbox write outside a transaction without the event-only opt-in', async () => {
    const event: DomainEvent = {
      eventId: EVENT_ID,
      eventType: 'feature_flags.created',
      aggregateId: '019dd1a5-9235-70db-8d57-540500000018',
      occurredAt: new Date(),
      organizationId: '019dd1a5-9235-70db-8d57-540500000019',
      payload: {},
    };

    await expect(publisher.publish(event)).rejects.toThrow(/event-only/);
    expect(await prisma.db.outboxEvent.count()).toBe(0);
    await publisher.publish(event, { eventOnly: true });
    expect(await prisma.db.outboxEvent.count()).toBe(1);
  });
}, 90_000);
