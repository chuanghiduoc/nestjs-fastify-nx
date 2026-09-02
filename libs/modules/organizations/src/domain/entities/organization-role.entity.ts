import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';
import {
  ALL_PERMISSIONS,
  isSystemRole,
  type Permission,
  generateId,
} from '@nestjs-fastify-nx/shared';

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,49}$/;

export interface OrganizationRoleProps {
  id: string;
  organizationId: string;
  role: string;
  permissions: readonly Permission[];
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CreateOrganizationRoleInput {
  id?: string;
  organizationId: string;
  role: string;
  permissions: readonly string[];
  grantedToActor: readonly Permission[];
}

function invalid(path: string, code: string, message: string, messageKey: string): never {
  throw new DomainException({
    kind: 'validation',
    code: ERROR_CODES.VALIDATION_FAILED,
    title: I18N_KEYS.common.unprocessable_entity,
    messageKey,
    violations: [{ path, code, message, messageKey }],
  });
}

function assertRoleName(role: string): void {
  if (!ROLE_NAME_PATTERN.test(role)) {
    invalid(
      'role',
      'invalid_role_name',
      'role must be 2-50 characters of lowercase letters, digits, hyphen or underscore, starting with a letter',
      I18N_KEYS.errors.organizations.invalid_role_name,
    );
  }
  if (isSystemRole(role)) {
    invalid(
      'role',
      'reserved_role_name',
      'role name is reserved by a built-in system role',
      I18N_KEYS.errors.organizations.reserved_role_name,
    );
  }
}

function assertKnownPermissions(permissions: readonly string[]): readonly Permission[] {
  if (permissions.length === 0) {
    invalid(
      'permissions',
      'empty_permissions',
      'a role must grant at least one permission',
      I18N_KEYS.errors.organizations.empty_permissions,
    );
  }

  const known = new Set<string>(ALL_PERMISSIONS);
  const unknown = permissions.filter((permission) => !known.has(permission));
  if (unknown.length > 0) {
    invalid(
      'permissions',
      'unknown_permission',
      `unknown permissions: ${unknown.join(', ')}`,
      I18N_KEYS.errors.organizations.unknown_permission,
    );
  }

  return [...new Set(permissions)] as Permission[];
}

function assertWithinActorGrant(
  permissions: readonly Permission[],
  grantedToActor: readonly Permission[],
): readonly Permission[] {
  const held = new Set<string>(grantedToActor);
  const escalating = permissions.filter((permission) => !held.has(permission));
  if (escalating.length > 0) {
    throw new DomainException({
      kind: 'forbidden',
      code: ERROR_CODES.FORBIDDEN,
      title: I18N_KEYS.common.forbidden,
      violations: [
        {
          path: 'permissions',
          code: 'permission_exceeds_grant',
          message: `permissions exceed the caller's own grant: ${escalating.join(', ')}`,
        },
      ],
    });
  }
  return permissions;
}

function resolveGrantablePermissions(
  permissions: readonly string[],
  grantedToActor: readonly Permission[],
): readonly Permission[] {
  return assertWithinActorGrant(assertKnownPermissions(permissions), grantedToActor);
}

export class OrganizationRole {
  private constructor(private readonly props: OrganizationRoleProps) {}

  static create(input: CreateOrganizationRoleInput): OrganizationRole {
    assertRoleName(input.role);
    return new OrganizationRole({
      id: input.id ?? generateId(),
      organizationId: input.organizationId,
      role: input.role,
      permissions: resolveGrantablePermissions(input.permissions, input.grantedToActor),
      createdAt: new Date(),
      updatedAt: null,
    });
  }

  static reconstitute(raw: OrganizationRoleProps): OrganizationRole {
    return new OrganizationRole(raw);
  }

  withPermissions(
    permissions: readonly string[],
    grantedToActor: readonly Permission[],
  ): OrganizationRole {
    return new OrganizationRole({
      ...this.props,
      permissions: resolveGrantablePermissions(permissions, grantedToActor),
      updatedAt: new Date(),
    });
  }

  get id(): string {
    return this.props.id;
  }
  get organizationId(): string {
    return this.props.organizationId;
  }
  get role(): string {
    return this.props.role;
  }
  get permissions(): readonly Permission[] {
    return this.props.permissions;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date | null {
    return this.props.updatedAt;
  }
}
