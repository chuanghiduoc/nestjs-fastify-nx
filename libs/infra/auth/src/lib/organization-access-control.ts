import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/organization/access';
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  type Permission,
  type SystemRole,
} from '@nestjs-fastify-nx/shared';

function groupByResource(permissions: readonly Permission[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const permission of permissions) {
    const [resource, action] = permission.split(':');
    if (!resource || !action) continue;
    (grouped[resource] ??= []).push(action);
  }
  return grouped;
}

// Better Auth's own statements govern its organization endpoints; the application catalog governs
// everything else. Merged so a tenant-defined role created through /organization/create-role can
// grant this app's permissions instead of only Better Auth's built-ins.
const statements = {
  ...defaultStatements,
  ...groupByResource(ALL_PERMISSIONS),
} as const;

export const organizationAccessControl = createAccessControl(statements);

function roleFor(role: SystemRole) {
  const appPermissions = groupByResource(SYSTEM_ROLE_PERMISSIONS[role]);
  // Owner and admin also administer the organization itself, which lives in Better Auth's own
  // statements; member-level roles get the application permissions only.
  const administers = role === SYSTEM_ROLES.OWNER || role === SYSTEM_ROLES.ADMIN;
  return organizationAccessControl.newRole({
    ...appPermissions,
    ...(administers
      ? {
          member: [...(appPermissions['member'] ?? []), 'create', 'update', 'delete'],
          invitation: [...(appPermissions['invitation'] ?? []), 'create', 'cancel'],
          team: [...(appPermissions['team'] ?? []), 'create', 'update', 'delete'],
          ac: ['create', 'read', 'update', 'delete'],
        }
      : {}),
  } as never);
}

export const organizationRoles = {
  [SYSTEM_ROLES.OWNER]: roleFor(SYSTEM_ROLES.OWNER),
  [SYSTEM_ROLES.ADMIN]: roleFor(SYSTEM_ROLES.ADMIN),
  [SYSTEM_ROLES.MEMBER]: roleFor(SYSTEM_ROLES.MEMBER),
  [SYSTEM_ROLES.BILLING]: roleFor(SYSTEM_ROLES.BILLING),
  [SYSTEM_ROLES.VIEWER]: roleFor(SYSTEM_ROLES.VIEWER),
};
