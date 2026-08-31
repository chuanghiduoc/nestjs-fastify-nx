import type { OrganizationRole } from '../entities/organization-role.entity';

export const ORGANIZATION_ROLE_REPOSITORY = Symbol('ORGANIZATION_ROLE_REPOSITORY');

export interface OrganizationRoleRepositoryPort {
  findAll(organizationId: string): Promise<OrganizationRole[]>;
  findByName(organizationId: string, role: string): Promise<OrganizationRole | null>;
  create(role: OrganizationRole): Promise<void>;
  update(role: OrganizationRole): Promise<void>;
  delete(organizationId: string, role: string): Promise<boolean>;
  countMembersHolding(organizationId: string, role: string): Promise<number>;
}
