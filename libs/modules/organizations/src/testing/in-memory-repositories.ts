import type { OrganizationRole } from '../domain/entities/organization-role.entity';
import type { Team } from '../domain/entities/team.entity';
import type {
  OrganizationRoleRepositoryPort,
  RoleDeletionOutcome,
} from '../domain/ports/organization-role-repository.port';
import type {
  FindTeamsCursorOptions,
  FindTeamsCursorResult,
  TeamRepositoryPort,
  TeamWithMemberCount,
} from '../domain/ports/team-repository.port';
import type {
  FindInvitationsCursorOptions,
  FindInvitationsCursorResult,
  InvitationRecord,
  InvitationRepositoryPort,
} from '../domain/ports/invitation-repository.port';
import type {
  OrganizationRepositoryPort,
  OrganizationSummary,
} from '../domain/ports/organization-repository.port';

export class InMemoryOrganizationRoleRepository implements OrganizationRoleRepositoryPort {
  private readonly roles = new Map<string, OrganizationRole>();
  private readonly holders = new Map<string, number>();

  private key(organizationId: string, role: string): string {
    return `${organizationId}::${role}`;
  }

  setHolders(organizationId: string, role: string, count: number): void {
    this.holders.set(this.key(organizationId, role), count);
  }

  findAll(organizationId: string): Promise<OrganizationRole[]> {
    return Promise.resolve(
      [...this.roles.values()].filter((role) => role.organizationId === organizationId),
    );
  }

  findByName(organizationId: string, role: string): Promise<OrganizationRole | null> {
    return Promise.resolve(this.roles.get(this.key(organizationId, role)) ?? null);
  }

  create(role: OrganizationRole): Promise<void> {
    this.roles.set(this.key(role.organizationId, role.role), role);
    return Promise.resolve();
  }

  update(role: OrganizationRole): Promise<void> {
    this.roles.set(this.key(role.organizationId, role.role), role);
    return Promise.resolve();
  }

  deleteUnlessHeld(organizationId: string, role: string): Promise<RoleDeletionOutcome> {
    const key = this.key(organizationId, role);
    if (!this.roles.has(key)) return Promise.resolve('not_found');
    if ((this.holders.get(key) ?? 0) > 0) return Promise.resolve('in_use');
    this.roles.delete(key);
    return Promise.resolve('deleted');
  }
}

export class InMemoryTeamRepository implements TeamRepositoryPort {
  private readonly teams = new Map<string, TeamWithMemberCount>();

  seed(team: Team, memberCount = 0): void {
    this.teams.set(team.id, Object.assign(team, { memberCount }));
  }

  findAllCursor(options: FindTeamsCursorOptions): Promise<FindTeamsCursorResult> {
    const matching = [...this.teams.values()]
      .filter((team) => team.organizationId === options.organizationId)
      .filter((team) =>
        options.search ? team.name.toLowerCase().includes(options.search.toLowerCase()) : true,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return Promise.resolve({
      items: matching.slice(0, options.limit),
      hasMore: matching.length > options.limit,
    });
  }

  findById(organizationId: string, id: string): Promise<TeamWithMemberCount | null> {
    const team = this.teams.get(id);
    return Promise.resolve(team && team.organizationId === organizationId ? team : null);
  }

  create(team: Team): Promise<void> {
    this.seed(team);
    return Promise.resolve();
  }

  update(team: Team): Promise<void> {
    const existing = this.teams.get(team.id);
    this.teams.set(team.id, Object.assign(team, { memberCount: existing?.memberCount ?? 0 }));
    return Promise.resolve();
  }

  delete(organizationId: string, id: string): Promise<boolean> {
    const team = this.teams.get(id);
    if (!team || team.organizationId !== organizationId) return Promise.resolve(false);
    return Promise.resolve(this.teams.delete(id));
  }
}

export class InMemoryInvitationRepository implements InvitationRepositoryPort {
  private readonly invitations = new Map<string, InvitationRecord>();

  seed(invitation: InvitationRecord): void {
    this.invitations.set(invitation.id, invitation);
  }

  findAllCursor(options: FindInvitationsCursorOptions): Promise<FindInvitationsCursorResult> {
    const now = new Date();
    const matching = [...this.invitations.values()]
      .filter((invitation) => invitation.organizationId === options.organizationId)
      .filter((invitation) => (options.status ? invitation.status === options.status : true))
      .filter((invitation) =>
        options.status === 'pending' ? invitation.expiresAt.getTime() > now.getTime() : true,
      )
      .filter((invitation) =>
        options.email ? invitation.email === options.email.toLowerCase() : true,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return Promise.resolve({
      items: matching.slice(0, options.limit),
      hasMore: matching.length > options.limit,
    });
  }

  findById(organizationId: string, id: string): Promise<InvitationRecord | null> {
    const invitation = this.invitations.get(id);
    return Promise.resolve(
      invitation && invitation.organizationId === organizationId ? invitation : null,
    );
  }

  async cancelPending(organizationId: string, id: string): Promise<boolean> {
    const invitation = await this.findById(organizationId, id);
    if (!invitation || invitation.status !== 'pending') return false;
    this.invitations.set(id, { ...invitation, status: 'canceled' });
    return true;
  }
}

export class InMemoryOrganizationRepository implements OrganizationRepositoryPort {
  private readonly organizations = new Map<string, OrganizationSummary>();

  seed(summary: OrganizationSummary): void {
    this.organizations.set(summary.id, summary);
  }

  findSummary(organizationId: string): Promise<OrganizationSummary | null> {
    return Promise.resolve(this.organizations.get(organizationId) ?? null);
  }
}
