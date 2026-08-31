import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';

function notFound(path: string, code: string, message: string, messageKey: string) {
  return new DomainException({
    kind: 'not_found',
    code,
    title: I18N_KEYS.common.not_found,
    messageKey,
    violations: [{ path, code, message, messageKey }],
  });
}

function conflict(path: string, code: string, message: string, messageKey: string) {
  return new DomainException({
    kind: 'conflict',
    permanent: false,
    code,
    title: I18N_KEYS.common.conflict,
    messageKey,
    violations: [{ path, code, message, messageKey }],
  });
}

export const organizationNotFound = () =>
  notFound(
    'organizationId',
    ERROR_CODES.ORGANIZATION_NOT_FOUND,
    'Organization not found',
    I18N_KEYS.errors.organizations.not_found,
  );

export const roleNotFound = () =>
  notFound(
    'role',
    ERROR_CODES.ORGANIZATION_ROLE_NOT_FOUND,
    'Role not found',
    I18N_KEYS.errors.organizations.role_not_found,
  );

export const roleAlreadyExists = () =>
  conflict(
    'role',
    ERROR_CODES.ORGANIZATION_ROLE_ALREADY_EXISTS,
    'A role with this name already exists in the organization',
    I18N_KEYS.errors.organizations.role_already_exists,
  );

export const roleInUse = () =>
  conflict(
    'role',
    ERROR_CODES.ORGANIZATION_ROLE_IN_USE,
    'Role is still assigned to at least one member',
    I18N_KEYS.errors.organizations.role_in_use,
  );

export const teamNotFound = () =>
  notFound(
    'id',
    ERROR_CODES.TEAM_NOT_FOUND,
    'Team not found',
    I18N_KEYS.errors.organizations.team_not_found,
  );

export const teamNameTaken = () =>
  conflict(
    'name',
    ERROR_CODES.TEAM_NAME_TAKEN,
    'A team with this name already exists in the organization',
    I18N_KEYS.errors.organizations.team_name_taken,
  );

export const invitationNotFound = () =>
  notFound(
    'id',
    ERROR_CODES.INVITATION_NOT_FOUND,
    'Invitation not found',
    I18N_KEYS.errors.organizations.invitation_not_found,
  );

export const invitationNotPending = () =>
  conflict(
    'id',
    ERROR_CODES.INVITATION_NOT_PENDING,
    'Only a pending invitation can be canceled',
    I18N_KEYS.errors.organizations.invitation_not_pending,
  );
