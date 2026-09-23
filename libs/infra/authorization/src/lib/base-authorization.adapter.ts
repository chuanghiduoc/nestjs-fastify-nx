import {
  SYSTEM_ROLE_PERMISSIONS,
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

export function permissionsForNonUserPrincipal(principal: Principal): readonly Permission[] | null {
  if (principal.type === 'system') return SYSTEM_ROLE_PERMISSIONS.owner;
  if (principal.type === 'api_key') {
    return principal.scopes.filter((scope): scope is Permission => scope.includes(':'));
  }
  return null;
}

export abstract class BaseAuthorizationAdapter implements AuthorizationPort {
  abstract readonly capabilities: AuthorizationCapabilities;

  abstract permissionsFor(principal: Principal): Promise<readonly Permission[]>;

  protected abstract policyContext(principal: Principal): Promise<PolicyContext>;

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

  // Reachability is derivable from organizationId/ownerId on the resource itself in both adapters,
  // so there is nothing to write on create/delete.
  async onResourceCreated(_input: {
    actor: Principal;
    resource: ResourceRef;
    relations?: readonly RelationInput[];
  }): Promise<void> {
    return Promise.resolve();
  }

  async onResourceDeleted(_resource: ResourceRef): Promise<void> {
    return Promise.resolve();
  }
}
