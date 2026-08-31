import type { DecodedCursor } from '@nestjs-fastify-nx/shared';

export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');

export const INVITATION_STATUSES = ['pending', 'accepted', 'rejected', 'canceled'] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export interface InvitationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: string | null;
  readonly teamId: string | null;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly inviterId: string;
  readonly createdAt: Date;
}

export interface FindInvitationsCursorOptions {
  organizationId: string;
  startingAfter?: DecodedCursor;
  limit: number;
  status?: InvitationStatus;
  email?: string;
}

export interface FindInvitationsCursorResult {
  items: InvitationRecord[];
  hasMore: boolean;
}

export interface InvitationRepositoryPort {
  findAllCursor(options: FindInvitationsCursorOptions): Promise<FindInvitationsCursorResult>;
  findById(organizationId: string, id: string): Promise<InvitationRecord | null>;
  /** Compare-and-set from `pending` to `canceled`; false when the row was no longer pending. */
  cancelPending(organizationId: string, id: string): Promise<boolean>;
}
