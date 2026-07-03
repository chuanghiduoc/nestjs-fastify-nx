import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OutboxRelayService } from './outbox-relay.service';
import type { PrismaService } from '@nestjs-fastify-nx/infra-database';
import type { EventBusService } from './event-bus.service';

interface OutboxRow {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: {
    schemaVersion?: number;
    eventId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  };
  attempts: number;
}

/**
 * Builds a fake PrismaService modelling the three-stage dispatch:
 *  - claim:    inside `transaction(...)` via tx.$queryRawUnsafe
 *  - mark/err: outside tx via prisma.db.$executeRawUnsafe (per row)
 *  - stuck:    outside tx via prisma.db.$queryRawUnsafe (count)
 */
function buildPrisma(opts: { claim: (limit: number) => OutboxRow[] }): {
  prisma: PrismaService;
  dbExecuteCalls: Array<{ sql: string; args: unknown[] }>;
} {
  const dbExecuteCalls: Array<{ sql: string; args: unknown[] }> = [];

  const transaction = vi.fn(async <T>(fn: (tx: unknown) => Promise<T>) =>
    fn({
      $queryRawUnsafe: vi.fn(async (_sql: string, _maxAttempts: number, batch: number) =>
        opts.claim(batch),
      ),
    }),
  );

  const db = {
    $queryRawUnsafe: vi.fn(async () => [{ count: BigInt(0) }]),
    $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      dbExecuteCalls.push({ sql, args });
    }),
  };

  return {
    prisma: { transaction, db } as unknown as PrismaService,
    dbExecuteCalls,
  };
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
    const { prisma, dbExecuteCalls } = buildPrisma({ claim: () => [] });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(0);
    expect(bus.publish).not.toHaveBeenCalled();
    expect(dbExecuteCalls).toHaveLength(0);
  });

  it('publishes claimed rows and marks them processed outside the claim transaction', async () => {
    const { prisma, dbExecuteCalls } = buildPrisma({ claim: () => [buildRow()] });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(1);
    expect(bus.publish).toHaveBeenCalledWith({
      eventId: 'evt-1',
      eventType: 'users.registered',
      aggregateId: 'user-1',
      occurredAt: new Date('2026-04-28T00:00:00.000Z'),
      payload: { email: 'a@b.c' },
    });

    // processedAt UPDATE runs outside the claim tx — keep this lookup tight
    // so a long-running listener can't ripple back into row-lock contention.
    expect(dbExecuteCalls).toHaveLength(1);
    expect(dbExecuteCalls[0].sql).toMatch(/processedAt/);
    expect(dbExecuteCalls[0].args[0]).toBeInstanceOf(Date);
    expect(dbExecuteCalls[0].args[1]).toBe('row-1');
  });

  it('records lastError on prisma.db without marking processed when the bus throws', async () => {
    const { prisma, dbExecuteCalls } = buildPrisma({
      claim: () => [buildRow({ attempts: 2 })],
    });
    const bus = buildBus();
    bus.publish.mockRejectedValueOnce(new Error('listener failed'));
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(0);

    expect(dbExecuteCalls).toHaveLength(1);
    expect(dbExecuteCalls[0].sql).toMatch(/lastError/);
    expect(dbExecuteCalls[0].args[0]).toContain('listener failed');
    expect(dbExecuteCalls[0].sql).not.toMatch(/processedAt/);
  });

  it('skips a row whose schemaVersion is newer than the relay supports and records the error', async () => {
    const { prisma, dbExecuteCalls } = buildPrisma({
      claim: () => [
        buildRow({
          payload: {
            schemaVersion: 99,
            eventId: 'evt-1',
            occurredAt: '2026-04-28T00:00:00.000Z',
            payload: { email: 'a@b.c' },
          },
        }),
      ],
    });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(0);
    // Never dispatched, never marked processed — only lastError recorded so the row
    // exhausts attempts and surfaces via the stuck-row warning.
    expect(bus.publish).not.toHaveBeenCalled();
    expect(dbExecuteCalls).toHaveLength(1);
    expect(dbExecuteCalls[0].sql).toMatch(/lastError/);
    expect(dbExecuteCalls[0].args[0]).toContain('schemaVersion=99');
    expect(dbExecuteCalls[0].sql).not.toMatch(/processedAt/);
  });

  it('dispatches a legacy row with no schemaVersion field (backward-compat: treated as v1)', async () => {
    // Rows written before envelope versioning carry no schemaVersion. They must still
    // dispatch so a rolling upgrade does not strand in-flight events.
    const { prisma } = buildPrisma({
      claim: () => [
        buildRow({
          payload: {
            eventId: 'legacy-1',
            occurredAt: '2026-04-28T00:00:00.000Z',
            payload: { email: 'legacy@b.c' },
          },
        }),
      ],
    });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(1);
    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'legacy-1', eventType: 'users.registered' }),
    );
  });

  it('does not hold the claim transaction across the publish call', async () => {
    // Build prisma where the tx callback resolves before publish is awaited.
    // We assert ordering by recording the sequence in which the two side
    // effects ran — tx must have committed BEFORE bus.publish.
    const order: string[] = [];
    const row = buildRow();

    const transaction = vi.fn(async <T>(fn: (tx: unknown) => Promise<T>) => {
      const result = await fn({
        $queryRawUnsafe: vi.fn(async () => [row]),
      });
      order.push('tx-commit');
      return result;
    });

    const prisma = {
      transaction,
      db: {
        $queryRawUnsafe: vi.fn(async () => [{ count: BigInt(0) }]),
        $executeRawUnsafe: vi.fn(async () => undefined),
      },
    } as unknown as PrismaService;

    const bus = buildBus();
    bus.publish.mockImplementationOnce(async () => {
      order.push('publish');
    });
    const relay = new OutboxRelayService(prisma, bus);

    await relay.tick();

    expect(order).toEqual(['tx-commit', 'publish']);
  });

  it('logs a warning when stuck rows exist (attempts >= maxAttempts, processedAt IS NULL)', async () => {
    const { prisma } = buildPrisma({ claim: () => [] });
    (prisma.db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { count: BigInt(2) },
    ]);
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    const warnSpy = vi.spyOn(
      (relay as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );

    await relay.tick();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2 permanently-stuck'));
  });

  it('skips overlapping ticks while a previous cycle is still running', async () => {
    let claimCalls = 0;
    let publishEntered!: () => void;
    let releasePublish!: () => void;
    const publishEnteredPromise = new Promise<void>((resolve) => (publishEntered = resolve));
    const publishCompleted = new Promise<void>((resolve) => (releasePublish = resolve));

    const { prisma } = buildPrisma({
      claim: () => {
        claimCalls++;
        return claimCalls === 1 ? [buildRow()] : [];
      },
    });
    const bus = buildBus();
    bus.publish.mockImplementationOnce(() => {
      publishEntered();
      return publishCompleted;
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
