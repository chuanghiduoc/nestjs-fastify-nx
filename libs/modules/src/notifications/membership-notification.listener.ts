import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainException } from '@nestjs-fastify-nx/core';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENTS, organizationEventPayloadSchema } from '@nestjs-fastify-nx/shared';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import { CreateNotificationCommand } from './create-notification';

export const NOTIFICATION_TYPES = {
  MEMBER_ADDED: 'organization.member_added',
  MEMBER_ROLE_UPDATED: 'organization.member_role_updated',
} as const;

interface DeliverableMembership {
  readonly organizationId: string;
  readonly userId: string;
  readonly role?: string;
  readonly oldRole?: string;
}

function requireDeliverableMembership(event: DomainEvent): DeliverableMembership {
  const payload = organizationEventPayloadSchema.safeParse(event.payload);
  if (!event.organizationId || !payload.success || !payload.data.userId) {
    throw new DomainException({
      kind: 'malformed',
      code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
      title: 'Invalid domain event',
      permanent: true,
      violations: [
        {
          path: 'payload',
          code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
          message: 'Membership event is not deliverable',
        },
      ],
    });
  }
  return {
    organizationId: event.organizationId,
    userId: payload.data.userId,
    ...(payload.data.role === undefined ? {} : { role: payload.data.role }),
    ...(payload.data.oldRole === undefined ? {} : { oldRole: payload.data.oldRole }),
  };
}

@Injectable()
export class MembershipNotificationListener {
  constructor(private readonly commandBus: CommandBus) {}

  @OnEvent(DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ADDED, {
    async: true,
    promisify: true,
    suppressErrors: false,
  })
  async handleMemberAdded(event: DomainEvent): Promise<void> {
    const membership = requireDeliverableMembership(event);

    await this.commandBus.execute(
      new CreateNotificationCommand({
        id: event.eventId,
        organizationId: membership.organizationId,
        userId: membership.userId,
        type: NOTIFICATION_TYPES.MEMBER_ADDED,
        title: 'Welcome to the organization',
        body: 'You were added as a member.',
        data: { role: membership.role ?? null },
        occurredAt: event.occurredAt,
      }),
    );
  }

  @OnEvent(DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ROLE_UPDATED, {
    async: true,
    promisify: true,
    suppressErrors: false,
  })
  async handleRoleUpdated(event: DomainEvent): Promise<void> {
    const membership = requireDeliverableMembership(event);

    await this.commandBus.execute(
      new CreateNotificationCommand({
        id: event.eventId,
        organizationId: membership.organizationId,
        userId: membership.userId,
        type: NOTIFICATION_TYPES.MEMBER_ROLE_UPDATED,
        title: 'Your role changed',
        body: `Your role is now "${membership.role ?? 'member'}".`,
        data: { role: membership.role ?? null, previousRole: membership.oldRole ?? null },
        occurredAt: event.occurredAt,
      }),
    );
  }
}
