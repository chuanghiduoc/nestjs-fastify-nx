import type { OrganizationRole } from '../entities/organization-role.entity';

export const ORGANIZATION_ROLE_REPOSITORY = Symbol('ORGANIZATION_ROLE_REPOSITORY');

export type RoleDeletionOutcome = 'deleted' | 'in_use' | 'not_found';

export type RoleUpdateOutcome = 'updated' | 'not_found' | 'stale';

export interface OrganizationRoleRepositoryPort {
  findAll(organizationId: string): Promise<OrganizationRole[]>;
  findByName(organizationId: string, role: string): Promise<OrganizationRole | null>;
  create(role: OrganizationRole): Promise<void>;
  update(role: OrganizationRole): Promise<RoleUpdateOutcome>;
  deleteUnlessHeld(organizationId: string, role: string): Promise<RoleDeletionOutcome>;
}
