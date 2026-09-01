import { Query } from '@nestjs/cqrs';
import type { InvitationStatus } from '../../../domain/ports/invitation-repository.port';
import type { InvitationDto } from '../../dto/organization-role.dto';

export interface ListInvitationsResult {
  data: InvitationDto[];
  hasMore: boolean;
  lastCursor: string | null;
}

export interface ListInvitationsFilters {
  readonly startingAfter?: string;
  readonly status?: InvitationStatus;
  readonly email?: string;
}

export class ListInvitationsQuery extends Query<ListInvitationsResult> {
  readonly organizationId: string;
  readonly limit: number;
  readonly startingAfter?: string;
  readonly status?: InvitationStatus;
  readonly email?: string;

  constructor(organizationId: string, limit: number, filters: ListInvitationsFilters = {}) {
    super();
    this.organizationId = organizationId;
    this.limit = limit;
    this.startingAfter = filters.startingAfter;
    this.status = filters.status;
    this.email = filters.email;
  }
}
