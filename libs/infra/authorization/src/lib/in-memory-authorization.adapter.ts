import {
  SYSTEM_ROLE_PERMISSIONS,
  isSystemRole,
  type Permission,
  type ResourceType,
} from '@nestjs-fastify-nx/shared';
import type {
  AccessDecision,
  AccessFilter,
  AuthorizationCapabilities,
  AuthorizationPort,
  CheckRequest,
  Principal,
  RelationInput,
  ResourceRef,
} from '@nestjs-fastify-nx/core';
import { decideAccess, decideFilter, type PolicyContext } from './access-policy';

function membershipKey(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}

/**
 * Second implementation of AuthorizationPort, kept because a port with a single implementation
 * always leaks its adapter's assumptions. It backs the conformance suite and lets a spec assert
 * authorization behaviour without a database.
 */
export class InMemoryAuthorizationAdapter implements AuthorizationPort {
  private readonly roles = new Map<string, string[]>();
  private readonly customRoles = new Map<string, readonly Permission[]>();

  readonly capabilities: AuthorizationCapabilities = {
    predicateFilter: true,
    hierarchy: false,
    consistency: 'strong',
  };

  setMemberRoles(organizationId: string, userId: string, roles: readonly string[]): void {
    this.roles.set(membershipKey(organizationId, userId), [...roles]);
  }

  defineCustomRole(organizationId: string, role: string, permissions: readonly Permission[]): void {
    this.customRoles.set(`${organizationId}:${role}`, [...permissions]);
  }

  reset(): void {
    this.roles.clear();
    this.customRoles.clear();
  }

  permissionsFor(principal: Principal): Promise<readonly Permission[]> {
    return Promise.resolve(this.resolvePermissions(principal));
  }

  private resolvePermissions(principal: Principal): readonly Permission[] {
    if (principal.type === 'system') return SYSTEM_ROLE_PERMISSIONS.owner;
    if (principal.type === 'api_key') {
      return principal.scopes.filter((scope): scope is Permission => scope.includes(':'));
    }

    const roles = this.roles.get(membershipKey(principal.organizationId, principal.userId));
    if (!roles) return [];

    const granted = new Set<Permission>();
    for (const role of roles) {
      if (isSystemRole(role)) {
        for (const permission of SYSTEM_ROLE_PERMISSIONS[role]) granted.add(permission);
        continue;
      }
      const custom = this.customRoles.get(`${principal.organizationId}:${role}`);
      if (custom) for (const permission of custom) granted.add(permission);
    }
    return [...granted];
  }

  async check(
    principal: Principal,
    permission: Permission,
    resource?: ResourceRef,
  ): Promise<AccessDecision> {
    const [decision] = decideAccess(await this.policyContext(principal), [
      { permission, resource },
    ]);
    return decision ?? { allowed: false, reason: 'no decision produced' };
  }

  async checkMany(
    principal: Principal,
    requests: readonly CheckRequest[],
  ): Promise<readonly AccessDecision[]> {
    return decideAccess(await this.policyContext(principal), requests);
  }

  async filter(
    principal: Principal,
    permission: Permission,
    resourceType: ResourceType,
  ): Promise<AccessFilter> {
    return decideFilter(await this.policyContext(principal), permission, resourceType);
  }

  private async policyContext(principal: Principal): Promise<PolicyContext> {
    return {
      principal,
      permissions: await this.permissionsFor(principal),
      isMember:
        principal.type !== 'user' ||
        this.roles.has(membershipKey(principal.organizationId, principal.userId)),
    };
  }

  onResourceCreated(_input: {
    actor: Principal;
    resource: ResourceRef;
    relations?: readonly RelationInput[];
  }): Promise<void> {
    return Promise.resolve();
  }

  onResourceDeleted(_resource: ResourceRef): Promise<void> {
    return Promise.resolve();
  }
}
