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

  it('does not claim rows while this scheduler replica is a follower', async () => {
    const { prisma } = buildPrisma({ claim: () => [buildRow()] });
    const relay = new OutboxRelayService(prisma, buildBus(), { isLeader: () => false });

    expect(await relay.tick()).toBe(0);
    expect(prisma.transaction).not.toHaveBeenCalled();
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

  it('records a malformed envelope and continues dispatching the rest of the batch', async () => {
    const malformed = buildRow({
      id: 'row-bad',
      payload: null as unknown as OutboxRow['payload'],
    });
    const valid = buildRow({ id: 'row-good' });
    const { prisma, dbExecuteCalls } = buildPrisma({ claim: () => [malformed, valid] });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(1);
    expect(bus.publish).toHaveBeenCalledOnce();
    expect(dbExecuteCalls).toHaveLength(2);
    expect(dbExecuteCalls[0].sql).toMatch(/lastError/);
    expect(dbExecuteCalls[0].args[0]).toBe('Invalid outbox payload envelope');
    expect(dbExecuteCalls[1].sql).toMatch(/processedAt/);
  });

  it('dispatches the whole batch sequentially and records mixed at-least-once results', async () => {
    const rows: OutboxRow[] = [
      buildRow({
        id: 'a1',
        aggregateId: 'agg-a',
        payload: { eventId: 'a1', occurredAt: '2026-04-28T00:00:00.000Z', payload: {} },
      }),
      buildRow({
        id: 'a2',
        aggregateId: 'agg-a',
        payload: { eventId: 'a2', occurredAt: '2026-04-28T00:00:01.000Z', payload: {} },
      }),
      buildRow({
        id: 'b1',
        aggregateId: 'agg-b',
        payload: { eventId: 'b1', occurredAt: '2026-04-28T00:00:00.000Z', payload: {} },
      }),
    ];
    const { prisma, dbExecuteCalls } = buildPrisma({ claim: () => rows });
    const bus = buildBus();
    bus.publish.mockImplementation(async (event: { eventId: string }) => {
      // a2 fails; a1 and b1 succeed. A failed row does not block the rest of the batch — every
      // claimed row is attempted (claimBatch already consumed each row's attempt).
      if (event.eventId === 'a2') throw new Error('listener failed for a2');
    });
    const relay = new OutboxRelayService(prisma, bus);

    const dispatchedCount = await relay.tick();

    expect(dispatchedCount).toBe(2);
    expect(bus.publish).toHaveBeenCalledTimes(3);

    const publishedIds = bus.publish.mock.calls.map(
      (call) => (call[0] as { eventId: string }).eventId,
    );
    // Claim order is preserved by sequential dispatch.
    expect(publishedIds).toEqual(['a1', 'a2', 'b1']);

    // All three rows got a per-row outcome recorded (2 processedAt, 1 lastError-only).
    // markProcessed's UPDATE also clears lastError, so distinguish recordError by the
    // absence of processedAt rather than by presence of the lastError substring alone.
    expect(dbExecuteCalls).toHaveLength(3);
    const processedCalls = dbExecuteCalls.filter((c) => c.sql.includes('processedAt'));
    const errorOnlyCalls = dbExecuteCalls.filter(
      (c) => c.sql.includes('lastError') && !c.sql.includes('processedAt'),
    );
    expect(processedCalls).toHaveLength(2);
    expect(errorOnlyCalls).toHaveLength(1);
    expect(errorOnlyCalls[0].args[1]).toBe('a2');
  });

  it('records a poison row as failed but keeps dispatching the rest of the batch', async () => {
    const bad = buildRow({
      id: 'p1',
      aggregateId: 'agg-a',
      payload: null as unknown as OutboxRow['payload'],
    });
    const good = buildRow({
      id: 'p2',
      aggregateId: 'agg-a',
      payload: { eventId: 'p2', occurredAt: '2026-04-28T00:00:01.000Z', payload: {} },
    });
    const { prisma } = buildPrisma({ claim: () => [bad, good] });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    // A permanently-undeliverable row must not block its aggregate forever — good still dispatches.
    expect(await relay.tick()).toBe(1);
    const publishedIds = bus.publish.mock.calls.map((c) => (c[0] as { eventId: string }).eventId);
    expect(publishedIds).toEqual(['p2']);
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

  it('checks for stuck rows at most once per minute', async () => {
    vi.useFakeTimers();
    try {
      const { prisma } = buildPrisma({ claim: () => [] });
      const relay = new OutboxRelayService(prisma, buildBus());

      await relay.tick();
      await relay.tick();
      expect(prisma.db.$queryRawUnsafe).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      await relay.tick();
      expect(prisma.db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

  it('contains scheduled tick failures so a database outage cannot crash the process', async () => {
    vi.useFakeTimers();
    try {
      const { prisma } = buildPrisma({ claim: () => [] });
      (prisma.transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('database unavailable'),
      );
      const relay = new OutboxRelayService(prisma, buildBus());
      const errorSpy = vi.spyOn(
        (relay as unknown as { logger: { error: (message: string) => void } }).logger,
        'error',
      );

      relay.onModuleInit();
      await vi.advanceTimersByTimeAsync(60_000);
      await relay.onModuleDestroy();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('database unavailable'));
    } finally {
      vi.useRealTimers();
    }
  });
});
