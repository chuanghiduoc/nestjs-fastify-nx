import {
  PERMISSIONS,
  RESOURCE_TYPES,
  resourceTypeOf,
  type Permission,
  type ResourceType,
} from '@nestjs-fastify-nx/shared';
import type {
  AccessDecision,
  AccessFilter,
  CheckRequest,
  Principal,
} from '@nestjs-fastify-nx/core';

export const OWNER_SCOPED_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.FILE_READ,
  PERMISSIONS.FILE_DELETE,
];

export const MEMBERSHIP_INDEPENDENT_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.SESSION_READ,
  PERMISSIONS.SESSION_REVOKE,
  PERMISSIONS.TERM_READ,
  PERMISSIONS.TERM_ACCEPT,
];

export const DENIAL_REASONS = {
  crossOrganization: 'resource belongs to another organization',
  notAMember: 'principal is not a member of the organization',
  permissionNotGranted: 'permission not granted',
} as const;

export type ResourceScope = 'organization' | 'organization_self' | 'self' | 'global';

const RESOURCE_SCOPES: Record<ResourceType, ResourceScope> = {
  [RESOURCE_TYPES.ORGANIZATION]: 'organization',
  [RESOURCE_TYPES.MEMBER]: 'organization',
  [RESOURCE_TYPES.TEAM]: 'organization',
  [RESOURCE_TYPES.INVITATION]: 'organization',
  [RESOURCE_TYPES.ROLE]: 'organization',
  [RESOURCE_TYPES.FILE]: 'organization',
  [RESOURCE_TYPES.AUDIT_LOG]: 'organization',
  [RESOURCE_TYPES.API_KEY]: 'organization',
  [RESOURCE_TYPES.FEATURE_FLAG]: 'organization',
  [RESOURCE_TYPES.NOTIFICATION]: 'organization_self',
  [RESOURCE_TYPES.SESSION]: 'self',
  [RESOURCE_TYPES.TERM]: 'global',
};

export function scopeOf(permission: Permission): ResourceScope {
  return RESOURCE_SCOPES[resourceTypeOf(permission)];
}

export function requiresMembership(permission: Permission): boolean {
  const scope = scopeOf(permission);
  return scope === 'organization' || scope === 'organization_self';
}

export interface PolicyContext {
  readonly principal: Principal;
  readonly permissions: readonly Permission[];
  readonly isMember: boolean;
}

function holdsMembershipIndependentGrant(principal: Principal, permission: Permission): boolean {
  return principal.type === 'user' && MEMBERSHIP_INDEPENDENT_PERMISSIONS.includes(permission);
}

function holds(context: PolicyContext, permission: Permission): boolean {
  return (
    context.permissions.includes(permission) ||
    holdsMembershipIndependentGrant(context.principal, permission)
  );
}

export function decideWithoutOrganization(
  permissions: readonly Permission[],
): readonly AccessDecision[] {
  return permissions.map((permission) =>
    !requiresMembership(permission) && MEMBERSHIP_INDEPENDENT_PERMISSIONS.includes(permission)
      ? { allowed: true }
      : { allowed: false, reason: DENIAL_REASONS.permissionNotGranted },
  );
}

export function decideAccess(
  context: PolicyContext,
  requests: readonly CheckRequest[],
): readonly AccessDecision[] {
  const { principal, isMember } = context;
  const nonMember = principal.type === 'user' && !isMember;

  return requests.map((request) => {
    if (nonMember && requiresMembership(request.permission)) {
      return { allowed: false, reason: DENIAL_REASONS.notAMember };
    }
    if (
      request.resource?.organizationId &&
      principal.type !== 'system' &&
      request.resource.organizationId !== principal.organizationId
    ) {
      return { allowed: false, reason: DENIAL_REASONS.crossOrganization };
    }
    if (holds(context, request.permission)) return { allowed: true };
    if (
      principal.type === 'user' &&
      isMember &&
      request.resource?.ownerId === principal.userId &&
      OWNER_SCOPED_PERMISSIONS.includes(request.permission)
    ) {
      return { allowed: true };
    }
    return { allowed: false, reason: DENIAL_REASONS.permissionNotGranted };
  });
}

export function decideFilter(
  context: PolicyContext,
  permission: Permission,
  resourceType: ResourceType,
): AccessFilter {
  const { principal, isMember } = context;

  // A permission only ever authorizes its own resource type. Without this the membership-independent
  // grant would answer for a type it says nothing about, and a caller with no organization would get
  // an unscoped predicate back.
  if (resourceTypeOf(permission) !== resourceType) return { kind: 'none' };

  if (principal.type === 'system') return { kind: 'all' };
  if (principal.type === 'user' && !isMember && requiresMembership(permission)) {
    return { kind: 'none' };
  }

  if (holds(context, permission)) {
    if (resourceType === RESOURCE_TYPES.ORGANIZATION) {
      return { kind: 'predicate', where: { id: principal.organizationId } };
    }
    switch (RESOURCE_SCOPES[resourceType]) {
      case 'organization':
        return { kind: 'predicate', where: { organizationId: principal.organizationId } };
      case 'organization_self':
        return principal.type === 'user'
          ? {
              kind: 'predicate',
              where: { organizationId: principal.organizationId, userId: principal.userId },
            }
          : { kind: 'predicate', where: { organizationId: principal.organizationId } };
      case 'self':
        return principal.type === 'user'
          ? { kind: 'predicate', where: { userId: principal.userId } }
          : { kind: 'none' };
      case 'global':
        return { kind: 'all' };
    }
  }

  if (principal.type === 'user' && isMember && OWNER_SCOPED_PERMISSIONS.includes(permission)) {
    return {
      kind: 'predicate',
      where: { organizationId: principal.organizationId, userId: principal.userId },
    };
  }

  return { kind: 'none' };
}
