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

/**
 * Builds a fake PrismaService that executes the transaction callback with a
 * fake tx client. The fake tx exposes:
 *   - $queryRawUnsafe → returns the rows produced by `opts.claim`
 *   - $executeRawUnsafe → records every call for assertion
 */
function buildPrisma(opts: { claim: (limit: number) => OutboxRow[] }): {
  prisma: PrismaService;
  txExecuteCalls: Array<{ sql: string; args: unknown[] }>;
} {
  const txExecuteCalls: Array<{ sql: string; args: unknown[] }> = [];

  const transaction = vi.fn(async <T>(fn: (tx: unknown) => Promise<T>) =>
    fn({
      $queryRawUnsafe: vi.fn(async (_sql: string, _maxAttempts: number, batch: number) =>
        opts.claim(batch),
      ),
      $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
        txExecuteCalls.push({ sql, args });
      }),
    }),
  );

  // Stub db.$queryRawUnsafe used by checkStuckRows — returns 0 stuck rows so
  // the periodic check doesn't emit spurious warnings during unit tests.
  const db = { $queryRawUnsafe: vi.fn(async () => [{ count: BigInt(0) }]) };

  return {
    prisma: { transaction, db } as unknown as PrismaService,
    txExecuteCalls,
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
    process.env['OUTBOX_TX_TIMEOUT_MS'] = '30000';
  });

  afterEach(() => {
    delete process.env['OUTBOX_POLL_INTERVAL_MS'];
    delete process.env['OUTBOX_BATCH_SIZE'];
    delete process.env['OUTBOX_MAX_ATTEMPTS'];
    delete process.env['OUTBOX_TX_TIMEOUT_MS'];
  });

  it('returns 0 when there is nothing to dispatch', async () => {
    const { prisma, txExecuteCalls } = buildPrisma({ claim: () => [] });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(0);
    expect(bus.publish).not.toHaveBeenCalled();
    expect(txExecuteCalls).toHaveLength(0);
  });

  it('publishes claimed rows and marks them processed inside the same transaction', async () => {
    const { prisma, txExecuteCalls } = buildPrisma({ claim: () => [buildRow()] });
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

    // processedAt UPDATE must go through tx, not a separate prisma.db call
    expect(txExecuteCalls).toHaveLength(1);
    expect(txExecuteCalls[0].sql).toMatch(/processedAt/);
    expect(txExecuteCalls[0].args[0]).toBeInstanceOf(Date);
    expect(txExecuteCalls[0].args[1]).toBe('row-1');
  });

  it('records lastError via tx.$executeRawUnsafe without marking processed when the bus throws', async () => {
    const { prisma, txExecuteCalls } = buildPrisma({
      claim: () => [buildRow({ attempts: 2 })],
    });
    const bus = buildBus();
    bus.publish.mockRejectedValueOnce(new Error('listener failed'));
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(0);

    // One lastError UPDATE, zero processedAt UPDATE
    expect(txExecuteCalls).toHaveLength(1);
    expect(txExecuteCalls[0].sql).toMatch(/lastError/);
    expect(txExecuteCalls[0].args[0]).toContain('listener failed');
    expect(txExecuteCalls[0].sql).not.toMatch(/processedAt/);
  });

  it('skips rows whose attempts already exceed maxAttempts and logs a warning', async () => {
    // maxAttempts is 5 (set in beforeEach); claim a row at attempts=6 (already over limit)
    const { prisma, txExecuteCalls } = buildPrisma({
      claim: () => [buildRow({ attempts: 6 })],
    });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    expect(await relay.tick()).toBe(0);
    expect(bus.publish).not.toHaveBeenCalled();
    expect(txExecuteCalls).toHaveLength(0);
  });

  it('passes timeout options to prisma.transaction to prevent P2028 rollback on large batches', async () => {
    const { prisma } = buildPrisma({ claim: () => [buildRow()] });
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    await relay.tick();

    // Verify transaction was called with { timeout, maxWait } so the relay
    // does not default to Prisma's 5000 ms limit (which causes P2028 under load).
    expect(prisma.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: 30_000, maxWait: 5_000 }),
    );
  });

  it('logs a warning when stuck rows exist (attempts >= maxAttempts, processedAt IS NULL)', async () => {
    const { prisma } = buildPrisma({ claim: () => [] });
    // Override db stub to return 2 stuck rows.
    (prisma.db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { count: BigInt(2) },
    ]);
    const bus = buildBus();
    const relay = new OutboxRelayService(prisma, bus);

    // Spy on the private logger to assert the warn is emitted.
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
