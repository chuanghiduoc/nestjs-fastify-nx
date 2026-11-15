import { describe, expect, it, vi } from 'vitest';
import type { CommandBus } from '@nestjs/cqrs';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENTS } from '@nestjs-fastify-nx/shared';
import { MembershipNotificationListener } from './membership-notification.listener';

function membershipEvent(
  payload: Record<string, unknown>,
  organizationId?: string | null,
): DomainEvent {
  return {
    eventId: '0190f5b0-0000-7000-8000-000000000001',
    eventType: DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ADDED,
    aggregateId: '0190f5b0-0000-7000-8000-000000000002',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    payload,
    ...(organizationId === undefined ? {} : { organizationId }),
  };
}

function listenerWithBus(): {
  listener: MembershipNotificationListener;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn();
  const bus = { execute } as unknown as CommandBus;
  return { listener: new MembershipNotificationListener(bus), execute };
}

describe('MembershipNotificationListener', () => {
  it('throws instead of silently dropping an event without an organization id', async () => {
    const { listener, execute } = listenerWithBus();

    await expect(
      listener.handleMemberAdded(
        membershipEvent({ userId: '0190f5b0-0000-7000-8000-000000000003' }),
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('throws instead of silently dropping an unparseable payload', async () => {
    const { listener, execute } = listenerWithBus();

    await expect(
      listener.handleMemberAdded(
        membershipEvent({ userId: 'not-a-uuid' }, '0190f5b0-0000-7000-8000-000000000004'),
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('throws instead of silently dropping a payload without a member id', async () => {
    const { listener, execute } = listenerWithBus();

    await expect(
      listener.handleRoleUpdated(
        membershipEvent({ role: 'admin' }, '0190f5b0-0000-7000-8000-000000000004'),
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('dispatches one notification for a deliverable event', async () => {
    const { listener, execute } = listenerWithBus();

    await listener.handleMemberAdded(
      membershipEvent(
        { userId: '0190f5b0-0000-7000-8000-000000000003', role: 'member' },
        '0190f5b0-0000-7000-8000-000000000004',
      ),
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
