import { describe, expect, it } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { ALL_PERMISSIONS, PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { OrganizationRole } from './organization-role.entity';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90600001';

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('OrganizationRole', () => {
  it('creates a role carrying the requested catalog permissions', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      grantedToActor: ALL_PERMISSIONS,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.MEMBER_READ],
    });

    expect(role.role).toBe('auditor');
    expect([...role.permissions].sort()).toEqual(
      [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.MEMBER_READ].sort(),
    );
    expect(role.updatedAt).toBeNull();
  });

  it('deduplicates a repeated permission', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      grantedToActor: ALL_PERMISSIONS,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.AUDIT_LOG_READ],
    });

    expect(role.permissions).toEqual([PERMISSIONS.AUDIT_LOG_READ]);
  });

  it.each(['Auditor', '1auditor', 'a', 'has space', 'toolong'.repeat(10)])(
    'rejects the malformed role name %j',
    (name) => {
      expect(() =>
        OrganizationRole.create({
          organizationId: ORG_ID,
          grantedToActor: ALL_PERMISSIONS,
          role: name,
          permissions: [PERMISSIONS.AUDIT_LOG_READ],
        }),
      ).toThrow(DomainException);
    },
  );

  it.each(['owner', 'admin', 'member', 'billing', 'viewer'])(
    'refuses to shadow the system role %j',
    (name) => {
      expect(() =>
        OrganizationRole.create({
          organizationId: ORG_ID,
          grantedToActor: ALL_PERMISSIONS,
          role: name,
          permissions: [PERMISSIONS.AUDIT_LOG_READ],
        }),
      ).toThrow(DomainException);
    },
  );

  it('rejects an empty permission set', () => {
    expect(() =>
      OrganizationRole.create({
        organizationId: ORG_ID,
        grantedToActor: ALL_PERMISSIONS,
        role: 'auditor',
        permissions: [],
      }),
    ).toThrow(DomainException);
  });

  it('rejects a permission outside the catalog', () => {
    expect(() =>
      OrganizationRole.create({
        organizationId: ORG_ID,
        grantedToActor: ALL_PERMISSIONS,
        role: 'auditor',
        permissions: ['file:teleport'],
      }),
    ).toThrow(DomainException);
  });

  it('replaces the permission set wholesale and stamps updatedAt', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      grantedToActor: ALL_PERMISSIONS,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.MEMBER_READ],
    });

    const updated = role.withPermissions([PERMISSIONS.FILE_READ], ALL_PERMISSIONS);

    expect(updated.permissions).toEqual([PERMISSIONS.FILE_READ]);
    expect(updated.updatedAt).toBeInstanceOf(Date);
    expect(role.permissions).toHaveLength(2);
  });

  it('validates the replacement set too', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      grantedToActor: ALL_PERMISSIONS,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
    });

    expect(() => role.withPermissions([], ALL_PERMISSIONS)).toThrow(DomainException);
    expect(() => role.withPermissions(['nope:read'], ALL_PERMISSIONS)).toThrow(DomainException);
  });

  it('refuses to grant a permission the actor does not hold', () => {
    const err = thrownBy(() =>
      OrganizationRole.create({
        organizationId: ORG_ID,
        grantedToActor: [PERMISSIONS.ROLE_CREATE, PERMISSIONS.AUDIT_LOG_READ],
        role: 'escalator',
        permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.ORGANIZATION_DELETE],
      }),
    );

    expect(err).toBeInstanceOf(DomainException);
    expect(err).toMatchObject({ kind: 'forbidden' });
  });

  it('accepts a permission set the actor fully holds', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      grantedToActor: [PERMISSIONS.ROLE_CREATE, PERMISSIONS.AUDIT_LOG_READ],
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
    });

    expect(role.permissions).toEqual([PERMISSIONS.AUDIT_LOG_READ]);
  });

  it('bounds the replacement set by the actor grant too', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      grantedToActor: ALL_PERMISSIONS,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
    });

    const err = thrownBy(() =>
      role.withPermissions([PERMISSIONS.ORGANIZATION_DELETE], [PERMISSIONS.AUDIT_LOG_READ]),
    );

    expect(err).toMatchObject({ kind: 'forbidden' });
    expect(role.permissions).toEqual([PERMISSIONS.AUDIT_LOG_READ]);
  });
});
