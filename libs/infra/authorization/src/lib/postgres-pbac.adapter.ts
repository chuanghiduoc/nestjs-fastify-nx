import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import {
  PERMISSIONS,
  RESOURCE_TYPES,
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

// Permissions a member always holds over a resource they own, even when their role does not grant
// the organization-wide equivalent.
const OWNER_SCOPED_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.FILE_READ,
  PERMISSIONS.FILE_DELETE,
];

const TENANT_SCOPED_RESOURCES: readonly ResourceType[] = [
  RESOURCE_TYPES.FILE,
  RESOURCE_TYPES.ORGANIZATION,
  RESOURCE_TYPES.MEMBER,
  RESOURCE_TYPES.TEAM,
  RESOURCE_TYPES.INVITATION,
  RESOURCE_TYPES.AUDIT_LOG,
  RESOURCE_TYPES.ROLE,
];

function parseCustomRolePermissions(raw: string): readonly Permission[] {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return [];

  const collected: Permission[] = [];
  for (const [resource, actions] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action === 'string') collected.push(`${resource}:${action}` as Permission);
    }
  }
  return collected;
}

@Injectable()
export class PostgresPbacAdapter implements AuthorizationPort {
  private readonly logger = new Logger(PostgresPbacAdapter.name);

  readonly capabilities: AuthorizationCapabilities = {
    predicateFilter: true,
    hierarchy: false,
    consistency: 'strong',
  };

  constructor(private readonly prisma: PrismaService) {}

  async permissionsFor(principal: Principal): Promise<readonly Permission[]> {
    if (principal.type === 'system') return SYSTEM_ROLE_PERMISSIONS.owner;
    if (principal.type === 'api_key') {
      return principal.scopes.filter((scope): scope is Permission => scope.includes(':'));
    }

    const membership = await this.prisma.db.member.findUnique({
      where: {
        organizationId_userId: {
          organizationId: principal.organizationId,
          userId: principal.userId,
        },
      },
      select: { role: true },
    });
    if (!membership) return [];

    // Better Auth stores a comma-separated list when a member holds several roles.
    const roles = membership.role
      .split(',')
      .map((role) => role.trim())
      .filter((role) => role.length > 0);

    const granted = new Set<Permission>();
    const customRoleNames: string[] = [];

    for (const role of roles) {
      if (isSystemRole(role)) {
        for (const permission of SYSTEM_ROLE_PERMISSIONS[role]) granted.add(permission);
      } else {
        customRoleNames.push(role);
      }
    }

    if (customRoleNames.length > 0) {
      const customRoles = await this.prisma.db.organizationRole.findMany({
        where: { organizationId: principal.organizationId, role: { in: customRoleNames } },
        select: { role: true, permission: true },
      });

      for (const customRole of customRoles) {
        try {
          for (const permission of parseCustomRolePermissions(customRole.permission)) {
            granted.add(permission);
          }
        } catch {
          // A malformed custom role must not silently widen or narrow access for the whole
          // request: skip it and make the operator aware.
          this.logger.error(
            { organizationId: principal.organizationId, role: customRole.role },
            'Ignoring custom role with unparseable permission payload',
          );
        }
      }
    }

    return [...granted];
  }

  async check(
    principal: Principal,
    permission: Permission,
    resource?: ResourceRef,
  ): Promise<AccessDecision> {
    if (resource?.organizationId && principal.type !== 'system') {
      if (resource.organizationId !== principal.organizationId) {
        return { allowed: false, reason: 'resource belongs to another organization' };
      }
    }

    const permissions = await this.permissionsFor(principal);
    if (principal.type === 'user' && !(await this.isMember(principal))) {
      return { allowed: false, reason: 'principal is not a member of the organization' };
    }
    if (permissions.includes(permission)) return { allowed: true };

    if (
      principal.type === 'user' &&
      resource?.ownerId === principal.userId &&
      OWNER_SCOPED_PERMISSIONS.includes(permission)
    ) {
      return { allowed: true };
    }

    return { allowed: false, reason: 'permission not granted' };
  }

  async checkMany(
    principal: Principal,
    requests: readonly CheckRequest[],
  ): Promise<readonly AccessDecision[]> {
    if (principal.type === 'user' && !(await this.isMember(principal))) {
      return requests.map(() => ({
        allowed: false,
        reason: 'principal is not a member of the organization',
      }));
    }
    const permissions = await this.permissionsFor(principal);

    return requests.map((request) => {
      if (
        request.resource?.organizationId &&
        principal.type !== 'system' &&
        request.resource.organizationId !== principal.organizationId
      ) {
        return { allowed: false, reason: 'resource belongs to another organization' };
      }
      if (permissions.includes(request.permission)) return { allowed: true };
      if (
        principal.type === 'user' &&
        request.resource?.ownerId === principal.userId &&
        OWNER_SCOPED_PERMISSIONS.includes(request.permission)
      ) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'permission not granted' };
    });
  }

  async filter(
    principal: Principal,
    permission: Permission,
    resourceType: ResourceType,
  ): Promise<AccessFilter> {
    if (principal.type === 'system') return { kind: 'all' };

    if (principal.type === 'user' && !(await this.isMember(principal))) return { kind: 'none' };
    const permissions = await this.permissionsFor(principal);
    const tenantScoped = TENANT_SCOPED_RESOURCES.includes(resourceType);

    if (permissions.includes(permission)) {
      if (resourceType === RESOURCE_TYPES.ORGANIZATION) {
        return { kind: 'predicate', where: { id: principal.organizationId } };
      }
      return tenantScoped
        ? { kind: 'predicate', where: { organizationId: principal.organizationId } }
        : { kind: 'all' };
    }

    // Falls back to the owner-scoped grant: the caller may not read the whole organization, but
    // may still read what they created.
    if (principal.type === 'user' && OWNER_SCOPED_PERMISSIONS.includes(permission)) {
      return {
        kind: 'predicate',
        where: { organizationId: principal.organizationId, userId: principal.userId },
      };
    }

    return { kind: 'none' };
  }

  private async isMember(principal: Principal): Promise<boolean> {
    if (principal.type !== 'user') return true;
    const membership = await this.prisma.db.member.findUnique({
      where: {
        organizationId_userId: {
          organizationId: principal.organizationId,
          userId: principal.userId,
        },
      },
      select: { id: true },
    });
    return !!membership;
  }

  async onResourceCreated(_input: {
    actor: Principal;
    resource: ResourceRef;
    relations?: readonly RelationInput[];
  }): Promise<void> {
    // Reachability is derivable from organizationId/ownerId here, so there is nothing to write.
  }

  async onResourceDeleted(_resource: ResourceRef): Promise<void> {
    // See onResourceCreated.
  }
}
