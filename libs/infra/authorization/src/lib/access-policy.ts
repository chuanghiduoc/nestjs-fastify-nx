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

const TENANT_SCOPED_RESOURCES: Record<ResourceType, boolean> = {
  [RESOURCE_TYPES.ORGANIZATION]: true,
  [RESOURCE_TYPES.MEMBER]: true,
  [RESOURCE_TYPES.TEAM]: true,
  [RESOURCE_TYPES.INVITATION]: true,
  [RESOURCE_TYPES.ROLE]: true,
  [RESOURCE_TYPES.FILE]: true,
  [RESOURCE_TYPES.AUDIT_LOG]: true,
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
    return TENANT_SCOPED_RESOURCES[resourceType]
      ? { kind: 'predicate', where: { organizationId: principal.organizationId } }
      : { kind: 'none' };
  }

  if (principal.type === 'user' && OWNER_SCOPED_PERMISSIONS.includes(permission)) {
    return {
      kind: 'predicate',
      where: { organizationId: principal.organizationId, userId: principal.userId },
    };
  }

  return { kind: 'none' };
}
