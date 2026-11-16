import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  groupPermissionsByResource,
  parsePermissionStatements,
  serializePermissionStatements,
  type Permission,
  type SystemRole,
} from '@nestjs-fastify-nx/shared';
import { organizationRoles } from './organization-access-control';

type RoleWithStatements = { statements?: Record<string, string[]> };

// Better Auth governs `/api/auth/organization/*` with its own access-control engine while the REST
// surface is governed by PostgresPbacAdapter. Both derive from SYSTEM_ROLE_PERMISSIONS, so they
// agree today — but nothing failed if an edit reached one and not the other. These tests are that
// missing check: a permission added to the catalog, or a role definition changed by hand, has to
// stay visible to both sides or this suite goes red.
describe('authorization engine parity — Better Auth AC vs the permission catalog', () => {
  const systemRoles = Object.values(SYSTEM_ROLES);

  function appPermissionsOf(role: SystemRole): Set<string> {
    const statements = (organizationRoles[role] as RoleWithStatements).statements ?? {};
    const catalog = new Set<string>(ALL_PERMISSIONS);

    const granted = new Set<string>();
    for (const [resource, actions] of Object.entries(statements)) {
      for (const action of actions) {
        const candidate = `${resource}:${action}`;
        // Better Auth's own statements (`ac`, plus its member/invitation/team verbs) are not part of
        // this application's catalog and are asserted separately in the sibling spec.
        if (catalog.has(candidate)) granted.add(candidate);
      }
    }
    return granted;
  }

  it.each(systemRoles)(
    'exposes exactly the catalog permissions of the "%s" role to Better Auth',
    (role) => {
      const fromAuthEngine = appPermissionsOf(role);
      const fromCatalog = new Set<string>(SYSTEM_ROLE_PERMISSIONS[role]);

      expect([...fromAuthEngine].sort()).toEqual([...fromCatalog].sort());
    },
  );

  it('defines a Better Auth role for every system role, and no extras', () => {
    expect(Object.keys(organizationRoles).sort()).toEqual([...systemRoles].sort());
  });

  it('keeps every catalog permission reachable through at least one system role', () => {
    const reachable = new Set<string>();
    for (const role of systemRoles) {
      for (const permission of SYSTEM_ROLE_PERMISSIONS[role]) reachable.add(permission);
    }

    expect([...ALL_PERMISSIONS].filter((permission) => !reachable.has(permission))).toEqual([]);
  });
});

// The wire format is the second place the two engines meet: a tenant role created through
// `/api/auth/organization/create-role` is persisted by Better Auth and read back by
// PostgresPbacAdapter. Both go through these helpers, so a round-trip must be lossless.
describe('custom role wire format round-trip', () => {
  it('survives serialize → parse without gaining or losing a permission', () => {
    const permissions = [...ALL_PERMISSIONS];

    const { granted, unknown } = parsePermissionStatements(
      serializePermissionStatements(permissions),
    );

    expect(unknown).toEqual([]);
    expect([...granted].sort()).toEqual([...permissions].sort());
  });

  it('groups a permission under the resource half of its name', () => {
    const grouped = groupPermissionsByResource(['audit_log:read' as Permission]);

    expect(grouped).toEqual({ audit_log: ['read'] });
  });

  it('reports a permission outside the catalog instead of silently granting it', () => {
    const { granted, unknown } = parsePermissionStatements(
      JSON.stringify({ file: ['read', 'teleport'] }),
    );

    expect(granted).toEqual(['file:read']);
    expect(unknown).toEqual(['file:teleport']);
  });

  it('ignores a malformed payload rather than throwing at the parse boundary', () => {
    expect(parsePermissionStatements(JSON.stringify({ file: 'read' }))).toEqual({
      granted: [],
      unknown: [],
    });
  });
});
