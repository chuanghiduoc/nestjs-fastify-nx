export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly createdAt: Date;
  readonly memberCount: number;
  readonly teamCount: number;
  readonly pendingInvitationCount: number;
}

export interface OrganizationRepositoryPort {
  findSummary(organizationId: string): Promise<OrganizationSummary | null>;
}
