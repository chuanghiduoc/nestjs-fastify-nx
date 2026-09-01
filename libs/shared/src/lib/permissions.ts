// DO NOT rename — role definitions persisted in `organization_roles.permission` carry these exact
// strings and outlive any deploy, so a rename is a data migration, not a refactor.
export const RESOURCE_TYPES = {
  ORGANIZATION: 'organization',
  MEMBER: 'member',
  TEAM: 'team',
  INVITATION: 'invitation',
  ROLE: 'role',
  FILE: 'file',
  AUDIT_LOG: 'audit_log',
  API_KEY: 'api_key',
  FEATURE_FLAG: 'feature_flag',
  NOTIFICATION: 'notification',
  SESSION: 'session',
  TERM: 'term',
} as const;

export type ResourceType = (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];

export const PERMISSIONS = {
  ORGANIZATION_READ: 'organization:read',
  ORGANIZATION_UPDATE: 'organization:update',
  ORGANIZATION_DELETE: 'organization:delete',

  MEMBER_READ: 'member:read',
  MEMBER_INVITE: 'member:invite',
  MEMBER_UPDATE: 'member:update',
  MEMBER_REMOVE: 'member:remove',

  TEAM_READ: 'team:read',
  TEAM_CREATE: 'team:create',
  TEAM_UPDATE: 'team:update',
  TEAM_DELETE: 'team:delete',

  INVITATION_READ: 'invitation:read',
  INVITATION_CANCEL: 'invitation:cancel',

  ROLE_READ: 'role:read',
  ROLE_CREATE: 'role:create',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',

  FILE_READ: 'file:read',
  FILE_CREATE: 'file:create',
  FILE_DELETE: 'file:delete',

  AUDIT_LOG_READ: 'audit_log:read',

  API_KEY_READ: 'api_key:read',
  API_KEY_CREATE: 'api_key:create',
  API_KEY_REVOKE: 'api_key:revoke',

  FEATURE_FLAG_READ: 'feature_flag:read',
  FEATURE_FLAG_MANAGE: 'feature_flag:manage',

  NOTIFICATION_READ: 'notification:read',
  NOTIFICATION_UPDATE: 'notification:update',

  SESSION_READ: 'session:read',
  SESSION_REVOKE: 'session:revoke',

  TERM_READ: 'term:read',
  TERM_ACCEPT: 'term:accept',
  TERM_MANAGE: 'term:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export function resourceTypeOf(permission: Permission): ResourceType {
  return permission.split(':')[0] as ResourceType;
}

// Wire format of `organization_roles.permission` — the shape Better Auth's access-control plugin
// reads and writes. Both the PBAC adapter and the role-management endpoints go through these two
// functions so a tenant role written by either path is readable by the other.
export function groupPermissionsByResource(
  permissions: readonly Permission[],
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const permission of permissions) {
    const [resource, action] = permission.split(':');
    if (!resource || !action) continue;
    (grouped[resource] ??= []).push(action);
  }
  return grouped;
}

export interface ParsedPermissionStatements {
  readonly granted: readonly Permission[];
  readonly unknown: readonly string[];
}

export function parsePermissionStatements(raw: string): ParsedPermissionStatements {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return { granted: [], unknown: [] };

  const granted: Permission[] = [];
  const unknown: string[] = [];
  for (const [resource, actions] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action !== 'string') continue;
      const candidate = `${resource}:${action}`;
      if ((ALL_PERMISSIONS as readonly string[]).includes(candidate)) {
        granted.push(candidate as Permission);
      } else {
        unknown.push(candidate);
      }
    }
  }
  return { granted, unknown };
}

export function serializePermissionStatements(permissions: readonly Permission[]): string {
  return JSON.stringify(groupPermissionsByResource(permissions));
}

// System roles ship with the product and cannot be edited by a tenant; custom roles live in
// `organization_roles` and are resolved on top of these.
export const SYSTEM_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  BILLING: 'billing',
  VIEWER: 'viewer',
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

const OWNER_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS;

const ADMIN_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (permission) => permission !== PERMISSIONS.ORGANIZATION_DELETE,
);

// Held by every member regardless of role: each one only ever reaches the caller's own rows,
// enforced by the owner-scoped branch of the access policy.
const SELF_SERVICE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.NOTIFICATION_READ,
  PERMISSIONS.NOTIFICATION_UPDATE,
  PERMISSIONS.SESSION_READ,
  PERMISSIONS.SESSION_REVOKE,
  PERMISSIONS.TERM_READ,
  PERMISSIONS.TERM_ACCEPT,
];

const MEMBER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.MEMBER_READ,
  PERMISSIONS.TEAM_READ,
  PERMISSIONS.FILE_READ,
  PERMISSIONS.FILE_CREATE,
  PERMISSIONS.FILE_DELETE,
  PERMISSIONS.FEATURE_FLAG_READ,
  ...SELF_SERVICE_PERMISSIONS,
];

const BILLING_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.MEMBER_READ,
  ...SELF_SERVICE_PERMISSIONS,
];

const VIEWER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.MEMBER_READ,
  PERMISSIONS.TEAM_READ,
  PERMISSIONS.FILE_READ,
  PERMISSIONS.FEATURE_FLAG_READ,
  ...SELF_SERVICE_PERMISSIONS,
];

export const SYSTEM_ROLE_PERMISSIONS: Readonly<Record<SystemRole, readonly Permission[]>> = {
  [SYSTEM_ROLES.OWNER]: OWNER_PERMISSIONS,
  [SYSTEM_ROLES.ADMIN]: ADMIN_PERMISSIONS,
  [SYSTEM_ROLES.MEMBER]: MEMBER_PERMISSIONS,
  [SYSTEM_ROLES.BILLING]: BILLING_PERMISSIONS,
  [SYSTEM_ROLES.VIEWER]: VIEWER_PERMISSIONS,
};

export function isSystemRole(role: string): role is SystemRole {
  return Object.hasOwn(SYSTEM_ROLE_PERMISSIONS, role);
}
