import {
  PERMISSIONS,
  RESOURCE_TYPES,
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

export interface PolicyContext {
  readonly principal: Principal;
  readonly permissions: readonly Permission[];
  readonly isMember: boolean;
}

export function decideAccess(
  context: PolicyContext,
  requests: readonly CheckRequest[],
): readonly AccessDecision[] {
  const { principal, permissions, isMember } = context;

  if (principal.type === 'user' && !isMember) {
    return requests.map(() => ({ allowed: false, reason: DENIAL_REASONS.notAMember }));
  }

  return requests.map((request) => {
    if (
      request.resource?.organizationId &&
      principal.type !== 'system' &&
      request.resource.organizationId !== principal.organizationId
    ) {
      return { allowed: false, reason: DENIAL_REASONS.crossOrganization };
    }
    if (permissions.includes(request.permission)) return { allowed: true };
    if (
      principal.type === 'user' &&
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
  const { principal, permissions, isMember } = context;

  if (principal.type === 'system') return { kind: 'all' };
  if (principal.type === 'user' && !isMember) return { kind: 'none' };

  if (permissions.includes(permission)) {
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

  if (principal.type === 'user' && OWNER_SCOPED_PERMISSIONS.includes(permission)) {
    return {
      kind: 'predicate',
      where: { organizationId: principal.organizationId, userId: principal.userId },
    };
  }

  return { kind: 'none' };
}
