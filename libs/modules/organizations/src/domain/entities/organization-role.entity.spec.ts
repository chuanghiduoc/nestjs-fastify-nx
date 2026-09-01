import { describe, expect, it } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { PERMISSIONS } from '@nestjs-fastify-nx/shared';
import { OrganizationRole } from './organization-role.entity';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90600001';

describe('OrganizationRole', () => {
  it('creates a role carrying the requested catalog permissions', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
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
          role: name,
          permissions: [PERMISSIONS.AUDIT_LOG_READ],
        }),
      ).toThrow(DomainException);
    },
  );

  it('rejects an empty permission set', () => {
    expect(() =>
      OrganizationRole.create({ organizationId: ORG_ID, role: 'auditor', permissions: [] }),
    ).toThrow(DomainException);
  });

  it('rejects a permission outside the catalog', () => {
    expect(() =>
      OrganizationRole.create({
        organizationId: ORG_ID,
        role: 'auditor',
        permissions: ['file:teleport'],
      }),
    ).toThrow(DomainException);
  });

  it('replaces the permission set wholesale and stamps updatedAt', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ, PERMISSIONS.MEMBER_READ],
    });

    const updated = role.withPermissions([PERMISSIONS.FILE_READ]);

    expect(updated.permissions).toEqual([PERMISSIONS.FILE_READ]);
    expect(updated.updatedAt).toBeInstanceOf(Date);
    expect(role.permissions).toHaveLength(2);
  });

  it('validates the replacement set too', () => {
    const role = OrganizationRole.create({
      organizationId: ORG_ID,
      role: 'auditor',
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
    });

    expect(() => role.withPermissions([])).toThrow(DomainException);
    expect(() => role.withPermissions(['nope:read'])).toThrow(DomainException);
  });
});
