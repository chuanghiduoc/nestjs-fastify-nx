import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainException } from '@nestjs-fastify-nx/core';
import type { DomainEvent } from '@nestjs-fastify-nx/core';
import { DOMAIN_EVENTS } from '@nestjs-fastify-nx/shared';
import { ERROR_CODES } from '@nestjs-fastify-nx/contracts';
import {
  organizationMemberAddedPayloadSchema,
  organizationMemberRoleUpdatedPayloadSchema,
} from '@nestjs-fastify-nx/modules/organizations/contract';
import type { z } from 'zod';
import { CreateNotificationCommand } from './create-notification';

export const NOTIFICATION_TYPES = {
  MEMBER_ADDED: 'organization.member_added',
  MEMBER_ROLE_UPDATED: 'organization.member_role_updated',
} as const;

interface DeliverableMembership<TPayload> {
  readonly organizationId: string;
  readonly payload: TPayload;
}

function undeliverableMembership(): DomainException {
  return new DomainException({
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

function requireDeliverableMembership<TSchema extends z.ZodType>(
  event: DomainEvent,
  schema: TSchema,
): DeliverableMembership<z.infer<TSchema>> {
  const payload = schema.safeParse(event.payload);
  if (!event.organizationId || !payload.success) throw undeliverableMembership();
  return { organizationId: event.organizationId, payload: payload.data };
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
    const membership = requireDeliverableMembership(event, organizationMemberAddedPayloadSchema);

    await this.commandBus.execute(
      new CreateNotificationCommand({
        id: event.eventId,
        organizationId: membership.organizationId,
        userId: membership.payload.userId,
        type: NOTIFICATION_TYPES.MEMBER_ADDED,
        title: 'Welcome to the organization',
        body: 'You were added as a member.',
        data: { role: membership.payload.role },
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
    const membership = requireDeliverableMembership(
      event,
      organizationMemberRoleUpdatedPayloadSchema,
    );

    await this.commandBus.execute(
      new CreateNotificationCommand({
        id: event.eventId,
        organizationId: membership.organizationId,
        userId: membership.payload.userId,
        type: NOTIFICATION_TYPES.MEMBER_ROLE_UPDATED,
        title: 'Your role changed',
        body: `Your role is now "${membership.payload.role}".`,
        data: { role: membership.payload.role, previousRole: membership.payload.oldRole },
        occurredAt: event.occurredAt,
      }),
    );
  }
}
