import type { DecodedCursor } from '@nestjs-fastify-nx/shared';

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FindSessionsCursorOptions {
  userId: string;
  startingAfter?: DecodedCursor;
  limit: number;
  activeOnly: boolean;
  now: Date;
}

export interface FindSessionsCursorResult {
  items: SessionRecord[];
  hasMore: boolean;
}

export interface SessionRepositoryPort {
  findAllCursor(options: FindSessionsCursorOptions): Promise<FindSessionsCursorResult>;
  findByIdForUser(userId: string, id: string): Promise<SessionRecord | null>;
  /** Deletes one session owned by the user; false when it did not exist. */
  deleteForUser(userId: string, id: string): Promise<boolean>;
  deleteAllForUserExcept(userId: string, keepSessionId: string): Promise<number>;
}
