import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENTS, organizationEventPayloadSchema } from '@nestjs-fastify-nx/shared';
import { CreateNotificationCommand } from '../commands/create-notification/create-notification.command';

export const NOTIFICATION_TYPES = {
  MEMBER_ADDED: 'organization.member_added',
  MEMBER_ROLE_UPDATED: 'organization.member_role_updated',
} as const;

@Injectable()
export class MembershipNotificationListener {
  constructor(private readonly commandBus: CommandBus) {}

  @OnEvent(DOMAIN_EVENTS.ORGANIZATIONS_MEMBER_ADDED, {
    async: true,
    promisify: true,
    suppressErrors: false,
  })
  async handleMemberAdded(event: DomainEvent): Promise<void> {
    const organizationId = event.organizationId;
    const payload = organizationEventPayloadSchema.safeParse(event.payload);
    if (!organizationId || !payload.success || !payload.data.userId) return;

    await this.commandBus.execute(
      new CreateNotificationCommand({
        // Derived from the outbox eventId so a redelivered event maps to the same row and the
        // repository's duplicate-key path makes it a no-op.
        id: event.eventId,
        organizationId,
        userId: payload.data.userId,
        type: NOTIFICATION_TYPES.MEMBER_ADDED,
        title: 'Welcome to the organization',
        body: 'You were added as a member.',
        data: { role: payload.data.role ?? null },
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
    const organizationId = event.organizationId;
    const payload = organizationEventPayloadSchema.safeParse(event.payload);
    if (!organizationId || !payload.success || !payload.data.userId) return;

    await this.commandBus.execute(
      new CreateNotificationCommand({
        id: event.eventId,
        organizationId,
        userId: payload.data.userId,
        type: NOTIFICATION_TYPES.MEMBER_ROLE_UPDATED,
        title: 'Your role changed',
        body: `Your role is now "${payload.data.role ?? 'member'}".`,
        data: { role: payload.data.role ?? null, previousRole: payload.data.oldRole ?? null },
        occurredAt: event.occurredAt,
      }),
    );
  }
}
