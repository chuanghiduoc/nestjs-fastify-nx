import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OutboxRelayService } from './outbox-relay.service';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { EventBusService } from './event-bus.service';

interface OutboxRow {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: { eventId: string; occurredAt: string; payload: Record<string, unknown> };
  attempts: number;
}

class FakeOutboxEventDelegate {
  readonly updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  readonly update = vi.fn(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      this.updates.push(args);
      return { id: args.where.id };
    },
  );
}

function buildPrisma(opts: {
  outbox: FakeOutboxEventDelegate;
  claim: (limit: number) => OutboxRow[];
}): PrismaService {
  const transaction = vi.fn(async <T>(fn: (tx: unknown) => Promise<T>) =>
    fn({
      $queryRawUnsafe: vi.fn(async (_sql: string, _maxAttempts: number, batch: number) =>
        opts.claim(batch),
      ),
    }),
  );
  return {
    db: { outboxEvent: opts.outbox },
    transaction,
  } as unknown as PrismaService;
}

function buildBus(): EventBusService & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn() } as unknown as EventBusService & {
    publish: ReturnType<typeof vi.fn>;
  };
}

function buildRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'row-1',
    eventType: 'users.registered',
    aggregateId: 'user-1',
    payload: {
      eventId: 'evt-1',
      occurredAt: '2026-04-28T00:00:00.000Z',
      payload: { email: 'a@b.c' },
    },
    attempts: 1,
    ...overrides,
  };
}

describe('OutboxRelayService', () => {
  beforeEach(() => {
    process.env['OUTBOX_POLL_INTERVAL_MS'] = '60000';
    process.env['OUTBOX_BATCH_SIZE'] = '10';
    process.env['OUTBOX_MAX_ATTEMPTS'] = '5';
  });

  afterEach(() => {
    delete process.env['OUTBOX_POLL_INTERVAL_MS'];
    delete process.env['OUTBOX_BATCH_SIZE'];
    delete process.env['OUTBOX_MAX_ATTEMPTS'];
  });

  it('returns 0 when there is nothing to dispatch', async () => {
    const outbox = new FakeOutboxEventDelegate();
    const bus = buildBus();
    const prisma = buildPrisma({ outbox, claim: () => [] });
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(0);
    expect(bus.publish).not.toHaveBeenCalled();
    expect(outbox.update).not.toHaveBeenCalled();
  });

  it('publishes claimed rows and marks them processed on success', async () => {
    const outbox = new FakeOutboxEventDelegate();
    const bus = buildBus();
    const prisma = buildPrisma({ outbox, claim: () => [buildRow()] });
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(1);
    expect(bus.publish).toHaveBeenCalledWith({
      eventId: 'evt-1',
      eventType: 'users.registered',
      aggregateId: 'user-1',
      occurredAt: new Date('2026-04-28T00:00:00.000Z'),
      payload: { email: 'a@b.c' },
    });
    expect(outbox.updates).toHaveLength(1);
    expect(outbox.updates[0].where).toEqual({ id: 'row-1' });
    expect(outbox.updates[0].data).toMatchObject({ lastError: null });
    expect(outbox.updates[0].data['processedAt']).toBeInstanceOf(Date);
  });

  it('records lastError without marking processed when the bus throws', async () => {
    const outbox = new FakeOutboxEventDelegate();
    const bus = buildBus();
    bus.publish.mockRejectedValueOnce(new Error('listener failed'));
    const prisma = buildPrisma({ outbox, claim: () => [buildRow({ attempts: 2 })] });
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(0);
    expect(outbox.updates).toHaveLength(1);
    expect(outbox.updates[0].data).toEqual({ lastError: 'Error: listener failed' });
  });

  it('skips overlapping ticks while a previous cycle is still running', async () => {
    const outbox = new FakeOutboxEventDelegate();
    const bus = buildBus();
    let claimCalls = 0;
    let publishEntered!: () => void;
    let releasePublish!: () => void;
    const publishEnteredPromise = new Promise<void>((resolve) => (publishEntered = resolve));
    const publishCompleted = new Promise<void>((resolve) => (releasePublish = resolve));
    bus.publish.mockImplementationOnce(() => {
      publishEntered();
      return publishCompleted;
    });
    const prisma = buildPrisma({
      outbox,
      claim: () => {
        claimCalls++;
        return claimCalls === 1 ? [buildRow()] : [];
      },
    });
    const relay = new OutboxRelayService(prisma, bus);

    const first = relay.tick();
    await publishEnteredPromise;

    expect(await relay.tick()).toBe(0);
    expect(claimCalls).toBe(1);

    releasePublish();
    expect(await first).toBe(1);
  });
});
