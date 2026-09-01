import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@nestjs-fastify-nx/infra-database';
import {
  SYSTEM_ROLE_PERMISSIONS,
  isSystemRole,
  parsePermissionStatements,
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

    const role = await this.membershipRole(principal);
    if (role === null) return [];
    return this.resolvePermissions(principal.organizationId, role);
  }

  private async membershipRole(principal: Principal): Promise<string | null> {
    if (principal.type !== 'user') return null;
    const membership = await this.prisma.db.member.findUnique({
      where: {
        organizationId_userId: {
          organizationId: principal.organizationId,
          userId: principal.userId,
        },
      },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  private async resolvePermissions(
    organizationId: string,
    rawRole: string,
  ): Promise<readonly Permission[]> {
    // Better Auth stores a comma-separated list when a member holds several roles.
    const roles = rawRole
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

    if (customRoleNames.length === 0) return [...granted];

    const customRoles = await this.prisma.db.organizationRole.findMany({
      where: { organizationId, role: { in: customRoleNames } },
      select: { role: true, permission: true },
    });

    for (const customRole of customRoles) {
      try {
        const { granted: valid, unknown } = parsePermissionStatements(customRole.permission);
        for (const permission of valid) granted.add(permission);
        if (unknown.length > 0) {
          this.logger.warn(
            { organizationId, role: customRole.role, unknown },
            'Custom role declares permissions outside the catalog; ignoring them',
          );
        }
      } catch {
        // A malformed custom role must not silently widen or narrow access for the whole
        // request: skip it and make the operator aware.
        this.logger.error(
          { organizationId, role: customRole.role },
          'Ignoring custom role with unparseable permission payload',
        );
      }
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
    if (principal.type !== 'user') {
      return { principal, permissions: await this.permissionsFor(principal), isMember: true };
    }

    const role = await this.membershipRole(principal);
    if (role === null) return { principal, permissions: [], isMember: false };

    return {
      principal,
      permissions: await this.resolvePermissions(principal.organizationId, role),
      isMember: true,
    };
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
