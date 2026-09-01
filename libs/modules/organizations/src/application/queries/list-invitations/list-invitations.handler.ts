import { Inject } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainException } from '@nestjs-fastify-nx/core';
import { invalidCursorProblem } from '@nestjs-fastify-nx/contracts';
import { decodeCursor, encodeCursor, type DecodedCursor } from '@nestjs-fastify-nx/shared';
import { INVITATION_REPOSITORY } from '../../../domain/ports/invitation-repository.port';
import type { InvitationRepositoryPort } from '../../../domain/ports/invitation-repository.port';
import type { InvitationDto } from '../../dto/organization-role.dto';
import { ListInvitationsQuery, type ListInvitationsResult } from './list-invitations.query';

@QueryHandler(ListInvitationsQuery)
export class ListInvitationsHandler implements IQueryHandler<
  ListInvitationsQuery,
  ListInvitationsResult
> {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepositoryPort,
  ) {}

  async execute(query: ListInvitationsQuery): Promise<ListInvitationsResult> {
    const { items, hasMore } = await this.invitations.findAllCursor({
      organizationId: query.organizationId,
      startingAfter: this.decodeStartingAfter(query.startingAfter),
      limit: query.limit,
      status: query.status,
      email: query.email,
    });

    const data: InvitationDto[] = items.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      teamId: invitation.teamId,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      inviterId: invitation.inviterId,
      createdAt: invitation.createdAt,
    }));

    const lastItem = items[items.length - 1];
    return {
      data,
      hasMore,
      lastCursor: lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null,
    };
  }

  private decodeStartingAfter(raw?: string): DecodedCursor | undefined {
    if (!raw) return undefined;
    const decoded = decodeCursor(raw);
    if (!decoded) throw new DomainException(invalidCursorProblem());
    return decoded;
  }
}
