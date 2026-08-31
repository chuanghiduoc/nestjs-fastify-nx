import type { DecodedCursor } from '@nestjs-fastify-nx/shared';
import type { Team } from '../entities/team.entity';

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');

export interface FindTeamsCursorOptions {
  organizationId: string;
  startingAfter?: DecodedCursor;
  limit: number;
  search?: string;
}

export type TeamWithMemberCount = Team & { readonly memberCount: number };

export interface FindTeamsCursorResult {
  items: TeamWithMemberCount[];
  hasMore: boolean;
}

export interface TeamRepositoryPort {
  findAllCursor(options: FindTeamsCursorOptions): Promise<FindTeamsCursorResult>;
  findById(organizationId: string, id: string): Promise<TeamWithMemberCount | null>;
  create(team: Team): Promise<void>;
  update(team: Team): Promise<void>;
  delete(organizationId: string, id: string): Promise<boolean>;
}
