export const PERSONAL_ORGANIZATION_REPOSITORY = Symbol('PERSONAL_ORGANIZATION_REPOSITORY');

export interface PersonalOrganizationRepositoryPort {
  findFirstOrganizationId(userId: string): Promise<string | null>;
  findUserIdentity(userId: string): Promise<{ name: string; email: string }>;
  createIfAbsent(userId: string, name: string, slug: string): Promise<string>;
}
